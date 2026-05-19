# 2026-05-19 — Productize the manual PR-flow from session #4

Context: during the agent-game-platform real-run, the maintainer had to hand-do
several steps (fetch origin, cherry-pick fixes onto a new branch, draft a PR
body with NEED_HUMAN list, open PR via `gh`) because d2p's existing `github-pr`
mode assumes a fast-forward push will always succeed and writes a thin PR body.
Encode those manual steps as product features.

## Plan

1. **PR body template (`pushAndOpenPR`)** — replace the 5-line hardcoded body
   with a `renderPrBody(ctx, gap, fix, sessionRejections)` helper:
   - block 1: gap title / severity / one-line description
   - block 2: reviewer scores (alignment + behavioral verdicts)
   - block 3: **NEED_HUMAN list** — same-session gaps the reviewer rejected,
     with `slug · reasonCode` per line
   - block 4: cost / token footer + d2p session ref
   Source for block 3: query `gaps` table for status=NEED_HUMAN with session_id.

2. **Conflict-aware push (`pushFixBranchOrCherryPick`)** — if `pushFixBranch`
   fails with `non-fast-forward` (stderr matches `rejected` + `non-fast-forward`),
   fall back to:
   - `git fetch origin <baseBranch>`
   - resolve the worktree's "work commit" (HEAD that's reachable from worktree
     branch but not from base)
   - in the **demo repo** (not the worktree), create a fresh branch
     `d2p/auto-fix/<slug>-<unix-ts>` from `origin/<baseBranch>`
   - `git cherry-pick <work-sha>` onto it
   - push the new branch with PAT-in-URL
   - return `{ ok: true, branch: <new branch name>, fallback: true }`
   - `pushAndOpenPR` uses the returned branch as PR head instead of `fix/<slug>`
   - On cherry-pick conflict: best-effort `git cherry-pick --abort`, return error,
     loop escalates gap to NEED_HUMAN with reason `CONFLICT`.

3. **UI: PR chip on CommitsTimeline rows** — extend `MergedCommitRow`
   (daemon types + UI types) with `prNumber: number | null` and
   `prUrl: string | null`; daemon's `listMergedCommits` already has access to
   fixes table fields. UI: small chip next to the verdict chips with
   `🔗 PR #N` linking to the PR.

## Expected Outputs

- `daemon/src/orchestrator/pr-body.ts` — `renderPrBody()` + unit tests
- `daemon/src/git/push.ts` — new `pushFixBranchOrCherryPick()` + ENOENT/conflict tests
- `daemon/src/orchestrator/loop.ts` — `pushAndOpenPR()` rewired to use both
- `daemon/src/types.ts` + `daemon/src/storage/queries.ts` — `MergedCommitRow`
  gains `prNumber` + `prUrl`; `listMergedCommits` returns them
- `ui/src/types.ts` + `ui/src/components/CommitsTimeline.tsx` — mirror + render
- All existing daemon tests still green
- A new test demonstrating cherry-pick fallback on a synthetic non-ff scenario

## How To Verify

```pwsh
# unit suites
cd D:\lll\d2p\daemon ; npx vitest run
cd D:\lll\d2p\ui     ; npm test

# typecheck both packages
cd D:\lll\d2p\daemon ; npx tsc --noEmit
cd D:\lll\d2p\ui     ; npx tsc --noEmit
```

PR body output is verified by snapshot test in `pr-body.test.ts`. Cherry-pick
fallback verified by a `push.test.ts` case that builds two diverging local repos
and asserts the new branch + cherry-pick happens.

## Probes

- `claude --model haiku -p 'list all files daemon/src/orchestrator/pr-body.ts touches as JSON'`
  → expect schema `{ files: string[] }` returning exactly the file above.
- general-purpose agent re-reads the diff and emits the same JSON. Mismatch =
  plan-not-implementation drift; do not ship.

## Out of scope

- Don't change `github-pr` mode default (still opt-in per session).
- Don't auto-merge PR (still user-merged).
- Don't add a new GitHub OAuth flow (still uses config.json token).
- Don't change `local-merge` mode behavior.
