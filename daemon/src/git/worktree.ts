import path from 'node:path';
import { existsSync } from 'node:fs';
import { git } from '../subproc/git.js';
import { computeWorktreePath } from '../util/path.js';

export class MergeConflictError extends Error {
  constructor(public slug: string, public stderr: string) {
    super(`merge conflict on fix/${slug}: ${stderr.slice(0, 200)}`);
    this.name = 'MergeConflictError';
  }
}

const COMMIT_ENV = ['-c', 'user.email=d2p@local', '-c', 'user.name=d2p'];

export async function ensureRepo(demoPath: string): Promise<void> {
  if (!existsSync(path.join(demoPath, '.git'))) {
    const init = await git(['init', '-q', '-b', 'main'], demoPath);
    if (init.exitCode !== 0) throw new Error(`git init failed: ${init.stderr}`);
  }
  // ensure there is at least one commit so worktrees can branch
  const rev = await git(['rev-parse', '--verify', 'HEAD'], demoPath);
  if (rev.exitCode !== 0) {
    await git(['add', '-A'], demoPath);
    const commit = await git(
      [...COMMIT_ENV, 'commit', '-q', '--allow-empty', '-m', 'chore: d2p initial commit'],
      demoPath,
    );
    if (commit.exitCode !== 0) throw new Error(`initial commit failed: ${commit.stderr}`);
  }
}

export async function getMainBranch(repoPath: string): Promise<string> {
  const sym = await git(['symbolic-ref', '--short', 'HEAD'], repoPath);
  if (sym.exitCode === 0 && sym.stdout.trim()) return sym.stdout.trim();
  return resolveBaseBranch(repoPath);
}

/**
 * Resolve the repo's default base branch by REF EXISTENCE only, never via the
 * current HEAD. Use this from inside a worktree: there HEAD points at the
 * `fix/<slug>` branch, so `getMainBranch`'s symbolic-ref shortcut would wrongly
 * return the fix branch and a diff against it would be empty.
 */
export async function resolveBaseBranch(repoPath: string): Promise<string> {
  for (const candidate of ['main', 'master']) {
    const ref = await git(['rev-parse', '--verify', candidate], repoPath);
    if (ref.exitCode === 0) return candidate;
  }
  throw new Error('cannot determine base branch');
}

export async function isClean(repoPath: string): Promise<boolean> {
  const r = await git(['status', '--porcelain'], repoPath);
  return r.exitCode === 0 && r.stdout.trim() === '';
}

export async function createFixWorktree(repoPath: string, slug: string): Promise<string> {
  await ensureRepo(repoPath);
  const main = await getMainBranch(repoPath);
  const wt = computeWorktreePath(repoPath, slug);

  // Clean up stale worktree/branch if any
  await git(['worktree', 'remove', '--force', wt], repoPath);
  await git(['branch', '-D', `fix/${slug}`], repoPath);

  const r = await git(['worktree', 'add', wt, '-b', `fix/${slug}`, main], repoPath);
  if (r.exitCode !== 0) throw new Error(`worktree add failed: ${r.stderr}`);
  return wt;
}

export async function mergeFix(
  repoPath: string,
  slug: string,
  gapTitle: string,
): Promise<{ mergeSha: string }> {
  const main = await getMainBranch(repoPath);
  const checkout = await git(['checkout', main], repoPath);
  if (checkout.exitCode !== 0) throw new Error(`checkout main failed: ${checkout.stderr}`);
  const merge = await git(
    [...COMMIT_ENV, 'merge', '--no-ff', `fix/${slug}`, '-m', `merge fix/${slug}: ${gapTitle}`],
    repoPath,
  );
  if (merge.exitCode !== 0) {
    await git(['merge', '--abort'], repoPath);
    throw new MergeConflictError(slug, merge.stderr);
  }
  const rev = await git(['rev-parse', 'HEAD'], repoPath);
  const sha = rev.stdout.trim();
  await git(['branch', '-d', `fix/${slug}`], repoPath);
  await git(['worktree', 'remove', computeWorktreePath(repoPath, slug)], repoPath);
  return { mergeSha: sha };
}

/**
 * No-merge finalize for local mode (default). The reviewed fix commit stays
 * on `fix/<slug>` for the user to merge/PR themselves — ZeroU must NEVER
 * advance the user's main automatically. Reads the fix branch HEAD sha (from
 * the worktree, which is checked out on `fix/<slug>`), then removes the
 * worktree but KEEPS the branch so the user can merge later. Returns a sha so
 * callers that consumed `mergeFix`'s `{ mergeSha }` keep getting a value.
 */
export async function finalizeFixNoMerge(
  repoPath: string,
  slug: string,
  worktreePath: string,
): Promise<{ mergeSha: string | null }> {
  const rev = await git(['rev-parse', 'HEAD'], worktreePath);
  const sha = rev.exitCode === 0 ? rev.stdout.trim() : null;
  // Remove the worktree WITHOUT deleting fix/<slug> (no `branch -D`).
  await git(['worktree', 'remove', worktreePath], repoPath);
  return { mergeSha: sha };
}

export async function rollbackLastCommitInWorktree(worktreePath: string): Promise<void> {
  await git(['reset', '--hard', 'HEAD^'], worktreePath);
}

export async function dropFix(repoPath: string, slug: string): Promise<void> {
  const wt = computeWorktreePath(repoPath, slug);
  await git(['worktree', 'remove', '--force', wt], repoPath);
  await git(['branch', '-D', `fix/${slug}`], repoPath);
}

export async function diffAgainstMain(worktreePath: string): Promise<string> {
  // Resolve the repo's actual default branch instead of assuming `main`.
  // On a `master`-default (or any non-`main`) repo, a literal `main` ref
  // makes git error with empty stdout — which the old code returned as a
  // valid "empty diff", letting reviewers approve an unseen change.
  // Resolve by ref existence (NOT current HEAD) — inside a worktree HEAD is
  // the fix branch, so getMainBranch's symbolic-ref path would pick the fix
  // branch and yield an empty (self) diff.
  const base = await resolveBaseBranch(worktreePath);
  const r = await git(['diff', `${base}...HEAD`], worktreePath);
  if (r.exitCode !== 0) {
    throw new Error(
      `git diff ${base}...HEAD failed (exit ${r.exitCode}): ${r.stderr.slice(0, 200)}`,
    );
  }
  return r.stdout;
}

export async function headSha(repoPath: string): Promise<string | null> {
  const r = await git(['rev-parse', 'HEAD'], repoPath);
  return r.exitCode === 0 ? r.stdout.trim() : null;
}
