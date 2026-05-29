import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  ensureRepo,
  getMainBranch,
  createFixWorktree,
  mergeFix,
  finalizeFixNoMerge,
  dropFix,
  diffAgainstMain,
  MergeConflictError,
} from './worktree.js';

let demoDir = '';

async function makeFixtureDemo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'd2p-wt-test-'));
  await writeFile(path.join(dir, 'README.md'), 'demo\n');
  return dir;
}

beforeEach(async () => {
  demoDir = await makeFixtureDemo();
});

afterEach(async () => {
  if (demoDir) await rm(demoDir, { recursive: true, force: true, maxRetries: 3 });
  demoDir = '';
});

describe('ensureRepo', () => {
  it('initializes git when missing and makes an initial commit', async () => {
    await ensureRepo(demoDir);
    const log = spawnSync('git', ['log', '--oneline'], { cwd: demoDir, encoding: 'utf8' });
    expect(log.status).toBe(0);
    expect(log.stdout).toContain('d2p initial commit');
  });

  it('is a no-op on an already-initialized repo with commits', async () => {
    await ensureRepo(demoDir);
    const firstLog = spawnSync('git', ['log', '--oneline'], { cwd: demoDir, encoding: 'utf8' });
    await ensureRepo(demoDir);
    const secondLog = spawnSync('git', ['log', '--oneline'], { cwd: demoDir, encoding: 'utf8' });
    expect(secondLog.stdout).toBe(firstLog.stdout);
  });
});

describe('getMainBranch', () => {
  it('returns the current branch name', async () => {
    await ensureRepo(demoDir);
    const branch = await getMainBranch(demoDir);
    expect(['main', 'master']).toContain(branch);
  });
});

describe('createFixWorktree + mergeFix + diffAgainstMain', () => {
  it('creates a branch, accepts a commit, merges back, drops worktree', async () => {
    await ensureRepo(demoDir);
    const wt = await createFixWorktree(demoDir, 'add-thing');

    // commit something in the worktree
    await writeFile(path.join(wt, 'NEW.txt'), 'hello\n');
    spawnSync('git', ['add', 'NEW.txt'], { cwd: wt });
    spawnSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'feat: add NEW.txt'],
      { cwd: wt },
    );

    const diff = await diffAgainstMain(wt);
    expect(diff).toContain('NEW.txt');

    const merged = await mergeFix(demoDir, 'add-thing', 'add NEW.txt');
    expect(merged.mergeSha).toMatch(/^[0-9a-f]{40}$/);

    // worktree removed
    const wtCheck = spawnSync('git', ['worktree', 'list'], { cwd: demoDir, encoding: 'utf8' });
    expect(wtCheck.stdout).not.toContain('add-thing');

    // NEW.txt now in main (line ending may be CRLF on Windows)
    const content = await readFile(path.join(demoDir, 'NEW.txt'), 'utf8');
    expect(content.trim()).toBe('hello');
  });
});

describe('finalizeFixNoMerge (default local-mode path)', () => {
  it('removes the worktree, KEEPS fix/<slug>, and main is NOT advanced', async () => {
    await ensureRepo(demoDir);
    const mainBefore = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: demoDir, encoding: 'utf8' }).stdout.trim();

    const wt = await createFixWorktree(demoDir, 'keep-me');
    await writeFile(path.join(wt, 'FEATURE.txt'), 'feature\n');
    spawnSync('git', ['add', 'FEATURE.txt'], { cwd: wt });
    spawnSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'feat: FEATURE.txt'],
      { cwd: wt },
    );
    const fixHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: wt, encoding: 'utf8' }).stdout.trim();

    const result = await finalizeFixNoMerge(demoDir, 'keep-me', wt);

    // Returns the fix branch HEAD sha (so callers that consumed mergeSha keep a value)
    expect(result.mergeSha).toBe(fixHead);

    // Worktree removed
    const wtList = spawnSync('git', ['worktree', 'list'], { cwd: demoDir, encoding: 'utf8' });
    expect(wtList.stdout).not.toContain('keep-me');

    // fix/keep-me branch STILL EXISTS (user merges it later)
    const branches = spawnSync('git', ['branch', '--list', 'fix/keep-me'], { cwd: demoDir, encoding: 'utf8' });
    expect(branches.stdout).toContain('fix/keep-me');

    // main HEAD UNCHANGED — the user's main must not be advanced by default
    const mainAfter = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: demoDir, encoding: 'utf8' }).stdout.trim();
    expect(mainAfter).toBe(mainBefore);
    expect(mainAfter).not.toBe(fixHead);

    // FEATURE.txt must NOT be in the demo working tree (lives only on the branch)
    const ls = spawnSync(
      process.platform === 'win32' ? 'cmd' : 'ls',
      process.platform === 'win32' ? ['/c', 'dir', '/b'] : [],
      { cwd: demoDir, encoding: 'utf8' },
    );
    expect(ls.stdout).not.toContain('FEATURE.txt');

    await dropFix(demoDir, 'keep-me');
  });
});

describe('diffAgainstMain on a master-default repo', () => {
  it('resolves the real base branch (master) instead of literal main', async () => {
    // Init a repo whose default branch is `master`, not `main`.
    const dir = await mkdtemp(path.join(os.tmpdir(), 'd2p-master-test-'));
    spawnSync('git', ['init', '-q', '-b', 'master'], { cwd: dir });
    await writeFile(path.join(dir, 'README.md'), 'demo\n');
    spawnSync('git', ['add', '-A'], { cwd: dir });
    spawnSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'],
      { cwd: dir },
    );

    const wt = await createFixWorktree(dir, 'on-master');
    await writeFile(path.join(wt, 'CHANGED.txt'), 'changed\n');
    spawnSync('git', ['add', 'CHANGED.txt'], { cwd: wt });
    spawnSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'feat: CHANGED.txt'],
      { cwd: wt },
    );

    // Old code (`git diff main...HEAD`) would error → empty diff. The fix
    // resolves `master` and produces a real diff containing the change.
    const diff = await diffAgainstMain(wt);
    expect(diff).toContain('CHANGED.txt');
    expect(diff.trim()).not.toBe('');

    await dropFix(dir, 'on-master');
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });
});

describe('dropFix', () => {
  it('removes a worktree and deletes the branch', async () => {
    await ensureRepo(demoDir);
    await createFixWorktree(demoDir, 'oops');
    await dropFix(demoDir, 'oops');
    const branches = spawnSync('git', ['branch', '--list', 'fix/oops'], { cwd: demoDir, encoding: 'utf8' });
    expect(branches.stdout.trim()).toBe('');
  });
});

describe('MergeConflictError', () => {
  it('throws on conflicting merges', async () => {
    await ensureRepo(demoDir);
    // Modify on main first
    await writeFile(path.join(demoDir, 'conflict.txt'), 'main-version\n');
    spawnSync('git', ['add', 'conflict.txt'], { cwd: demoDir });
    spawnSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'main: conflict'],
      { cwd: demoDir },
    );

    // Create worktree from PREVIOUS main commit (before the conflict.txt)
    spawnSync('git', ['reset', '--hard', 'HEAD~1'], { cwd: demoDir });
    const wt = await createFixWorktree(demoDir, 'conflict');
    await writeFile(path.join(wt, 'conflict.txt'), 'fix-version\n');
    spawnSync('git', ['add', 'conflict.txt'], { cwd: wt });
    spawnSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'fix: conflict'],
      { cwd: wt },
    );

    // Bring main back up so the merge target is the conflicting one
    spawnSync('git', ['reset', '--hard', 'HEAD@{1}'], { cwd: demoDir });

    await expect(mergeFix(demoDir, 'conflict', 'merge conflict test')).rejects.toBeInstanceOf(
      MergeConflictError,
    );
    await dropFix(demoDir, 'conflict');
  });
});

describe('createFixWorktree cleanup of stale state', () => {
  it('overwrites a pre-existing fix/<slug> branch + worktree', async () => {
    await ensureRepo(demoDir);
    const wt1 = await createFixWorktree(demoDir, 'redo');
    await writeFile(path.join(wt1, 'a.txt'), 'a');
    // Second call should remove and recreate cleanly.
    const wt2 = await createFixWorktree(demoDir, 'redo');
    expect(wt2).toBe(wt1);
    // worktree should not contain a.txt anymore
    const ls = spawnSync(
      process.platform === 'win32' ? 'cmd' : 'ls',
      process.platform === 'win32' ? ['/c', 'dir', '/b'] : [],
      { cwd: wt2, encoding: 'utf8' },
    );
    expect(ls.stdout).not.toContain('a.txt');
    await dropFix(demoDir, 'redo');
  });
});

// silence unused mkdir import warning on some platforms
void mkdir;
