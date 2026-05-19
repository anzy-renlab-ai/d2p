// Push a fix branch to the demo's `origin` remote, using a PAT-in-URL so we
// don't depend on the user's GCM / SSH key being available to the daemon
// process. The PAT is masked in any returned error / log strings.

import { git } from '../subproc/git.js';

const SAFE_BRANCH = /^[a-zA-Z0-9._/-]+$/;

export interface PushResult {
  ok: boolean;
  remoteRef: string;
  stderr: string;
  /** When set, the actual branch pushed (cherry-pick fallback may rename it). */
  branch?: string;
  /** True when push fell back to the cherry-pick-onto-origin/base path. */
  fallback?: boolean;
}

/** Heuristic: detect non-fast-forward / behind-remote rejection from git stderr. */
function isNonFastForward(stderr: string): boolean {
  return /\brejected\b/i.test(stderr) && /non-fast-forward|behind|fetch first/i.test(stderr);
}

/**
 * Returns the URL or remote name to push to. For GitHub origins we embed the
 * PAT so we don't depend on the user's local credential manager; otherwise
 * (file://, gitea, etc.) we push to `origin` as-is.
 */
async function resolvePushTarget(
  repoPath: string,
  token: string,
  owner: string,
  repo: string,
): Promise<string> {
  const origin = await readOriginUrl(repoPath);
  if (origin && /github\.com/.test(origin)) {
    return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  }
  return 'origin';
}

function maskToken(token: string): string {
  if (token.length <= 8) return '****';
  return token.slice(0, 4) + '…' + token.slice(-4);
}

function maskInString(s: string, token: string): string {
  if (!token) return s;
  return s.split(token).join(maskToken(token));
}

/**
 * `repoPath` is the demo's git work-tree; `branch` is e.g. `fix/auth-signup`.
 * Pushes via `https://x-access-token:<token>@github.com/owner/repo.git`.
 * Existing `origin` URL is parsed for owner/repo; we don't rely on having
 * the origin URL contain credentials.
 */
export async function pushFixBranch(input: {
  repoPath: string;
  branch: string;
  token: string;
  owner: string;
  repo: string;
}): Promise<PushResult> {
  if (!SAFE_BRANCH.test(input.branch)) {
    return { ok: false, remoteRef: '', stderr: 'invalid branch name' };
  }
  // If the demo's `origin` already points at github.com, inject the PAT into
  // the URL so we don't depend on the user's GCM. For local file:// or other
  // remotes (smoke tests, self-hosted gitea, etc.), push to `origin` as-is.
  const origin = await readOriginUrl(input.repoPath);
  let pushTarget: string;
  if (origin && /github\.com/.test(origin)) {
    pushTarget = `https://x-access-token:${input.token}@github.com/${input.owner}/${input.repo}.git`;
  } else if (origin) {
    pushTarget = 'origin';
  } else {
    return { ok: false, remoteRef: '', stderr: 'no origin remote configured' };
  }
  const r = await git(
    ['push', '--set-upstream', pushTarget, `${input.branch}:${input.branch}`],
    input.repoPath,
    { timeoutMs: 90_000 },
  );
  return {
    ok: r.exitCode === 0,
    remoteRef: `refs/heads/${input.branch}`,
    stderr: maskInString(r.stderr, input.token),
  };
}

export async function readOriginUrl(repoPath: string): Promise<string | null> {
  const r = await git(['remote', 'get-url', 'origin'], repoPath, { timeoutMs: 5000 });
  if (r.exitCode !== 0) return null;
  return r.stdout.trim();
}

/**
 * Push the fix branch; if the push is rejected as non-fast-forward (because
 * the remote has commits the local base doesn't), automatically:
 *   1) fetch origin/<baseBranch>
 *   2) build a fresh branch `d2p/auto-fix/<slug>-<unix-ts>` from origin/<baseBranch>
 *   3) cherry-pick every commit on the original branch since baseBranch
 *   4) push the fresh branch
 *
 * Returns the new branch name in `branch` and `fallback: true` so the caller
 * can use that name as the PR head ref. On cherry-pick conflict, aborts the
 * cherry-pick and returns `ok: false` with a `CONFLICT` reason in stderr.
 */
export async function pushFixBranchOrCherryPick(input: {
  repoPath: string;
  branch: string;
  baseBranch: string;
  slug: string;
  token: string;
  owner: string;
  repo: string;
}): Promise<PushResult> {
  if (!SAFE_BRANCH.test(input.branch) || !SAFE_BRANCH.test(input.baseBranch)) {
    return { ok: false, remoteRef: '', stderr: 'invalid branch name' };
  }

  // Primary attempt — simple direct push.
  const primary = await pushFixBranch({
    repoPath: input.repoPath,
    branch: input.branch,
    token: input.token,
    owner: input.owner,
    repo: input.repo,
  });
  if (primary.ok) {
    return { ...primary, branch: input.branch, fallback: false };
  }
  if (!isNonFastForward(primary.stderr)) {
    return { ...primary, branch: input.branch, fallback: false };
  }

  // Non-fast-forward → cherry-pick to a fresh branch off origin/<baseBranch>.
  const newBranch = `d2p/auto-fix/${input.slug}-${Date.now()}`;
  const pushTarget = await resolvePushTarget(input.repoPath, input.token, input.owner, input.repo);

  // 1. Fetch latest origin/<baseBranch>
  const fetched = await git(['fetch', pushTarget, input.baseBranch], input.repoPath, {
    timeoutMs: 90_000,
  });
  if (fetched.exitCode !== 0) {
    return {
      ok: false,
      remoteRef: '',
      branch: input.branch,
      fallback: true,
      stderr: `fetch failed: ${maskInString(fetched.stderr, input.token).slice(0, 300)}`,
    };
  }

  // 2. List commits to cherry-pick: anything on <branch> not on <baseBranch>.
  const revList = await git(
    ['rev-list', '--reverse', `${input.baseBranch}..${input.branch}`],
    input.repoPath,
    { timeoutMs: 5000 },
  );
  if (revList.exitCode !== 0) {
    return {
      ok: false,
      remoteRef: '',
      branch: input.branch,
      fallback: true,
      stderr: `rev-list failed: ${revList.stderr.slice(0, 300)}`,
    };
  }
  const shas = revList.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (shas.length === 0) {
    return {
      ok: false,
      remoteRef: '',
      branch: input.branch,
      fallback: true,
      stderr: 'no work commits found between base and fix branch',
    };
  }

  // 3. Create the new branch from FETCH_HEAD (origin/<baseBranch>).
  const branched = await git(['branch', newBranch, 'FETCH_HEAD'], input.repoPath, {
    timeoutMs: 5000,
  });
  if (branched.exitCode !== 0) {
    return {
      ok: false,
      remoteRef: '',
      branch: input.branch,
      fallback: true,
      stderr: `branch create failed: ${branched.stderr.slice(0, 300)}`,
    };
  }

  // 4. Cherry-pick each work commit onto the new branch. We use the
  // `--worktree` form is not available — instead, point HEAD at the new
  // branch via `git -c` doesn't work either; we'll use `git switch` only
  // within the demo repo, so commit history is preserved. To avoid disturbing
  // the user's checked-out branch, we record current branch and restore at
  // the end.
  const curBranchRes = await git(['rev-parse', '--abbrev-ref', 'HEAD'], input.repoPath, {
    timeoutMs: 5000,
  });
  const previousBranch = curBranchRes.exitCode === 0 ? curBranchRes.stdout.trim() : null;

  const switched = await git(['switch', newBranch], input.repoPath, { timeoutMs: 5000 });
  if (switched.exitCode !== 0) {
    return {
      ok: false,
      remoteRef: '',
      branch: input.branch,
      fallback: true,
      stderr: `switch failed: ${switched.stderr.slice(0, 300)}`,
    };
  }

  let cherryPickError: string | null = null;
  for (const sha of shas) {
    const cp = await git(['cherry-pick', sha], input.repoPath, { timeoutMs: 30_000 });
    if (cp.exitCode !== 0) {
      cherryPickError = `cherry-pick ${sha.slice(0, 8)} failed: ${cp.stderr.slice(0, 300)}`;
      await git(['cherry-pick', '--abort'], input.repoPath, { timeoutMs: 5000 });
      break;
    }
  }

  // Restore previous branch regardless of outcome.
  if (previousBranch) {
    await git(['switch', previousBranch], input.repoPath, { timeoutMs: 5000 });
  }

  if (cherryPickError) {
    // Clean up the half-baked branch so we don't accumulate cruft.
    await git(['branch', '-D', newBranch], input.repoPath, { timeoutMs: 5000 });
    return {
      ok: false,
      remoteRef: '',
      branch: input.branch,
      fallback: true,
      stderr: `CONFLICT: ${cherryPickError}`,
    };
  }

  // 5. Push the new branch.
  const pushed = await git(
    ['push', '--set-upstream', pushTarget, `${newBranch}:${newBranch}`],
    input.repoPath,
    { timeoutMs: 90_000 },
  );
  if (pushed.exitCode !== 0) {
    return {
      ok: false,
      remoteRef: '',
      branch: newBranch,
      fallback: true,
      stderr: `push fallback branch failed: ${maskInString(pushed.stderr, input.token).slice(0, 300)}`,
    };
  }

  return {
    ok: true,
    remoteRef: `refs/heads/${newBranch}`,
    branch: newBranch,
    fallback: true,
    stderr: maskInString(pushed.stderr, input.token),
  };
}
