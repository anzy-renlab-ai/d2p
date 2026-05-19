/**
 * Tests for parseDiff / parsePatch.
 *
 * Creates a real temp git repo with several commits (add / modify / delete /
 * rename / binary) and asserts the structured output.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { parseDiff, parsePatch } from './diff.js';

// ── helpers ─────────────────────────────────────────────────────────────────

function git(args: string[], cwd: string) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed:\n${r.stderr}`);
  return r.stdout;
}

function commit(cwd: string, msg: string) {
  spawnSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '--allow-empty', '-qm', msg],
    { cwd },
  );
}

function initRepo(cwd: string) {
  git(['init', '-b', 'main'], cwd);
  git(['config', 'user.email', 't@t'], cwd);
  git(['config', 'user.name', 'T'], cwd);
}

// ── fixture ──────────────────────────────────────────────────────────────────

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'd2p-diff-test-'));
  initRepo(dir);
  // initial empty commit so HEAD exists
  commit(dir, 'init');
});

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  dir = '';
});

// ── getShas ──────────────────────────────────────────────────────────────────

function getSha(cwd: string, ref = 'HEAD'): string {
  return git(['rev-parse', ref], cwd).trim();
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('parseDiff', () => {
  it('detects added file', async () => {
    const fromSha = getSha(dir);

    await writeFile(path.join(dir, 'hello.txt'), 'hello\nworld\n');
    git(['add', 'hello.txt'], dir);
    commit(dir, 'add hello.txt');
    const toSha = getSha(dir);

    const files = await parseDiff(dir, fromSha, toSha);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe('hello.txt');
    expect(files[0]!.status).toBe('added');
    expect(files[0]!.insertions).toBe(2);
    expect(files[0]!.deletions).toBe(0);
    expect(files[0]!.binary).toBe(false);
    expect(files[0]!.hunks).toHaveLength(1);
    expect(files[0]!.hunks[0]!.lines.some((l) => l.type === 'add' && l.text === 'hello')).toBe(true);
  });

  it('detects modified file with multiline hunk', async () => {
    // setup: add a file first
    await writeFile(path.join(dir, 'multi.txt'), 'line1\nline2\nline3\nline4\nline5\n');
    git(['add', 'multi.txt'], dir);
    commit(dir, 'add multi');

    const fromSha = getSha(dir);

    // modify: change line2 and line4
    await writeFile(path.join(dir, 'multi.txt'), 'line1\nLINE2\nline3\nLINE4\nline5\n');
    git(['add', 'multi.txt'], dir);
    commit(dir, 'modify multi');

    const toSha = getSha(dir);

    const files = await parseDiff(dir, fromSha, toSha);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe('multi.txt');
    expect(files[0]!.status).toBe('modified');
    expect(files[0]!.insertions).toBeGreaterThan(0);
    expect(files[0]!.deletions).toBeGreaterThan(0);
    // At least one del line and one add line
    const allLines = files[0]!.hunks.flatMap((h) => h.lines);
    expect(allLines.some((l) => l.type === 'del')).toBe(true);
    expect(allLines.some((l) => l.type === 'add')).toBe(true);
  });

  it('detects deleted file', async () => {
    await writeFile(path.join(dir, 'gone.txt'), 'bye\n');
    git(['add', 'gone.txt'], dir);
    commit(dir, 'add gone');

    const fromSha = getSha(dir);

    git(['rm', 'gone.txt'], dir);
    commit(dir, 'delete gone');

    const toSha = getSha(dir);

    const files = await parseDiff(dir, fromSha, toSha);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe('gone.txt');
    expect(files[0]!.status).toBe('deleted');
    expect(files[0]!.deletions).toBe(1);
    expect(files[0]!.insertions).toBe(0);
  });

  it('detects binary file', async () => {
    const fromSha = getSha(dir);

    // Write a null byte — git detects as binary
    const buf = Buffer.alloc(8);
    buf[0] = 0xff;
    buf[1] = 0xd8;
    buf[2] = 0x00;
    await writeFile(path.join(dir, 'image.bin'), buf);
    git(['add', 'image.bin'], dir);
    commit(dir, 'add binary');

    const toSha = getSha(dir);

    const files = await parseDiff(dir, fromSha, toSha);
    const binFile = files.find((f) => f.path === 'image.bin');
    expect(binFile).toBeDefined();
    expect(binFile!.binary).toBe(true);
    expect(binFile!.hunks).toHaveLength(0);
  });

  it('handles renamed file with --find-renames', async () => {
    await writeFile(path.join(dir, 'old-name.ts'), 'export const x = 1;\n');
    git(['add', 'old-name.ts'], dir);
    commit(dir, 'add old-name');

    const fromSha = getSha(dir);

    git(['mv', 'old-name.ts', 'new-name.ts'], dir);
    commit(dir, 'rename to new-name');

    const toSha = getSha(dir);

    const files = await parseDiff(dir, fromSha, toSha);
    expect(files).toHaveLength(1);
    expect(files[0]!.status).toBe('renamed');
    expect(files[0]!.path).toBe('new-name.ts');
    expect(files[0]!.oldPath).toBe('old-name.ts');
  });

  it('handles multiple files in one diff', async () => {
    const fromSha = getSha(dir);

    await writeFile(path.join(dir, 'a.txt'), 'aaa\n');
    await writeFile(path.join(dir, 'b.txt'), 'bbb\n');
    git(['add', '.'], dir);
    commit(dir, 'add a and b');

    const toSha = getSha(dir);

    const files = await parseDiff(dir, fromSha, toSha);
    expect(files.map((f) => f.path).sort()).toEqual(['a.txt', 'b.txt']);
    expect(files.every((f) => f.status === 'added')).toBe(true);
  });
});

// ── parsePatch unit tests (no git required) ──────────────────────────────────

describe('parsePatch', () => {
  it('returns empty array for empty input', () => {
    expect(parsePatch('')).toEqual([]);
  });

  it('parses a simple patch string', () => {
    const patch = [
      'diff --git a/foo.ts b/foo.ts',
      'new file mode 100644',
      'index 0000000..abc1234',
      '--- /dev/null',
      '+++ b/foo.ts',
      '@@ -0,0 +1,2 @@',
      '+line one',
      '+line two',
    ].join('\n');

    const files = parsePatch(patch);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe('foo.ts');
    expect(files[0]!.status).toBe('added');
    expect(files[0]!.insertions).toBe(2);
    expect(files[0]!.deletions).toBe(0);
    expect(files[0]!.hunks[0]!.newStart).toBe(1);
  });

  it('parses a deleted file', () => {
    const patch = [
      'diff --git a/bar.ts b/bar.ts',
      'deleted file mode 100644',
      'index abc1234..0000000',
      '--- a/bar.ts',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-old line',
    ].join('\n');

    const files = parsePatch(patch);
    expect(files[0]!.status).toBe('deleted');
    expect(files[0]!.deletions).toBe(1);
  });

  it('parses binary file marker', () => {
    const patch = [
      'diff --git a/img.png b/img.png',
      'new file mode 100644',
      'index 0000000..deadbeef',
      'Binary files /dev/null and b/img.png differ',
    ].join('\n');

    const files = parsePatch(patch);
    expect(files[0]!.binary).toBe(true);
    expect(files[0]!.hunks).toHaveLength(0);
  });

  it('assigns correct line numbers in hunk', () => {
    const patch = [
      'diff --git a/nums.ts b/nums.ts',
      'index abc..def 100644',
      '--- a/nums.ts',
      '+++ b/nums.ts',
      '@@ -5,3 +5,3 @@',
      ' ctx',
      '-del line',
      '+add line',
    ].join('\n');

    const files = parsePatch(patch);
    const hunk = files[0]!.hunks[0]!;
    const ctx = hunk.lines[0]!;
    const del = hunk.lines[1]!;
    const add = hunk.lines[2]!;

    expect(ctx.type).toBe('context');
    expect(ctx.oldLineNo).toBe(5);
    expect(ctx.newLineNo).toBe(5);

    expect(del.type).toBe('del');
    expect(del.oldLineNo).toBe(6);
    expect(del.newLineNo).toBeNull();

    expect(add.type).toBe('add');
    expect(add.oldLineNo).toBeNull();
    expect(add.newLineNo).toBe(6);
  });
});
