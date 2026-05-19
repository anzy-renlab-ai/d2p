/**
 * Tests for pushFixBranchOrCherryPick — focuses on the non-fast-forward
 * fallback path. Uses a local bare remote so we don't hit github.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { git } from '../subproc/git.js';
import { pushFixBranchOrCherryPick } from './push.js';

let workRoot: string;
let bareRepo: string;
let demoRepo: string;

async function shell(args: string[], cwd: string): Promise<string> {
  const r = await git(args, cwd, { timeoutMs: 15_000 });
  if (r.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${r.exitCode}): ${r.stderr}`);
  }
  return r.stdout;
}

beforeEach(async () => {
  workRoot = mkdtempSync(path.join(tmpdir(), 'd2p-push-'));
  bareRepo = path.join(workRoot, 'remote.git');
  demoRepo = path.join(workRoot, 'demo');

  // 1. Bare remote
  await shell(['init', '--bare', '-b', 'main', bareRepo], workRoot);

  // 2. Demo clone with initial commit
  await shell(['clone', bareRepo, demoRepo], workRoot);
  await shell(['config', 'user.email', 'test@d2p.local'], demoRepo);
  await shell(['config', 'user.name', 'd2p-test'], demoRepo);
  await writeFile(path.join(demoRepo, 'README.md'), 'init\n');
  await shell(['add', '.'], demoRepo);
  await shell(['commit', '-m', 'initial'], demoRepo);
  await shell(['push', '-u', 'origin', 'main'], demoRepo);
});

function cleanup() {
  if (workRoot) rmSync(workRoot, { recursive: true, force: true });
}

describe('pushFixBranchOrCherryPick — fast-forward path', () => {
  it('pushes a fresh fix branch successfully without fallback', async () => {
    // Make a fix branch with one commit
    await shell(['checkout', '-b', 'fix/add-changelog'], demoRepo);
    await writeFile(path.join(demoRepo, 'CHANGELOG.md'), '# changelog\n');
    await shell(['add', '.'], demoRepo);
    await shell(['commit', '-m', 'docs: add CHANGELOG'], demoRepo);

    const res = await pushFixBranchOrCherryPick({
      repoPath: demoRepo,
      branch: 'fix/add-changelog',
      baseBranch: 'main',
      slug: 'add-changelog',
      token: 'dummy', // unused for non-github origin
      owner: 'irrelevant',
      repo: 'irrelevant',
    });

    expect(res.ok).toBe(true);
    expect(res.fallback).toBe(false);
    expect(res.branch).toBe('fix/add-changelog');

    cleanup();
  });
});

describe('pushFixBranchOrCherryPick — non-fast-forward fallback', () => {
  it('cherry-picks onto a new branch when remote rejects existing branch', async () => {
    // Push an "old" version of fix/feature with a stale commit
    await shell(['checkout', '-b', 'fix/feature'], demoRepo);
    await writeFile(path.join(demoRepo, 'feature.md'), 'old version\n');
    await shell(['add', '.'], demoRepo);
    await shell(['commit', '-m', 'old commit'], demoRepo);
    await shell(['push', '-u', 'origin', 'fix/feature'], demoRepo);

    // Local user "resets" their work: drop the old commit, write a new fix
    await shell(['checkout', 'main'], demoRepo);
    await shell(['branch', '-D', 'fix/feature'], demoRepo);
    await shell(['checkout', '-b', 'fix/feature'], demoRepo);
    await writeFile(path.join(demoRepo, 'feature.md'), 'new version\n');
    await shell(['add', '.'], demoRepo);
    await shell(['commit', '-m', 'docs: rewrite feature note'], demoRepo);

    const res = await pushFixBranchOrCherryPick({
      repoPath: demoRepo,
      branch: 'fix/feature',
      baseBranch: 'main',
      slug: 'feature',
      token: 'dummy',
      owner: 'irrelevant',
      repo: 'irrelevant',
    });

    expect(res.ok).toBe(true);
    expect(res.fallback).toBe(true);
    expect(res.branch).toMatch(/^d2p\/auto-fix\/feature-\d+$/);

    // Verify the fallback branch landed on the remote with the new content
    const probeDir = path.join(workRoot, 'probe');
    await shell(['clone', bareRepo, probeDir], workRoot);
    await shell(['fetch', 'origin', res.branch!], probeDir);
    await shell(['checkout', res.branch!], probeDir);
    const content = await readFile(path.join(probeDir, 'feature.md'), 'utf8');
    expect(content.trim()).toBe('new version');

    cleanup();
  });

  it('returns CONFLICT when cherry-pick onto origin/base fails', async () => {
    // Push a remote-only commit on main that conflicts with the local fix
    const otherRepo = path.join(workRoot, 'other');
    await shell(['clone', bareRepo, otherRepo], workRoot);
    await shell(['config', 'user.email', 'other@d2p.local'], otherRepo);
    await shell(['config', 'user.name', 'd2p-other'], otherRepo);
    await writeFile(path.join(otherRepo, 'conflict.md'), 'REMOTE WINS\n');
    await shell(['add', '.'], otherRepo);
    await shell(['commit', '-m', 'remote-only conflict'], otherRepo);
    await shell(['push', 'origin', 'main'], otherRepo);

    // Local: create fix branch from stale main, write conflicting content
    await shell(['checkout', '-b', 'fix/conflict'], demoRepo);
    await writeFile(path.join(demoRepo, 'conflict.md'), 'LOCAL WINS\n');
    await shell(['add', '.'], demoRepo);
    await shell(['commit', '-m', 'docs: conflicting'], demoRepo);

    // Push the stale fix branch first so the remote already has fix/conflict
    await shell(['push', '-u', 'origin', 'fix/conflict'], demoRepo);

    // Now rewrite the local fix branch to force non-ff
    await shell(['checkout', 'main'], demoRepo);
    await shell(['branch', '-D', 'fix/conflict'], demoRepo);
    await shell(['checkout', '-b', 'fix/conflict'], demoRepo);
    await writeFile(path.join(demoRepo, 'conflict.md'), 'LOCAL TAKE TWO\n');
    await shell(['add', '.'], demoRepo);
    await shell(['commit', '-m', 'docs: take two'], demoRepo);

    const res = await pushFixBranchOrCherryPick({
      repoPath: demoRepo,
      branch: 'fix/conflict',
      baseBranch: 'main',
      slug: 'conflict',
      token: 'dummy',
      owner: 'irrelevant',
      repo: 'irrelevant',
    });

    expect(res.ok).toBe(false);
    expect(res.fallback).toBe(true);
    expect(res.stderr).toMatch(/CONFLICT/);

    cleanup();
  });
});
