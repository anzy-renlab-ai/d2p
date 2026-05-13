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
