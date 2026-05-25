# Phase 3 Dispatch Notes

Constraints surfaced during Phase 1.5 worker self-report. Lead applies these when dispatching Phase 3 track workers (issues #4 / #5 / #6).

1. **Worker MUST NOT run `/to-prd` after receiving issue.** The issue body IS the PRD. Running `/to-prd` would generate a duplicate.

2. **Worker's FIRST action: extend tests doc.** Authors of new Behavior IDs introduced in Phase 1.5 (`B-7-1/2/3` in P2; `B-10-1..6` in A) MUST add corresponding `T-x-y-z` cases to `docs/details/13-protocol-2-tests.md` / `15-hardener-cli-tests.md` BEFORE writing source. Tests-first; no exceptions.

3. **Lead verifies worktree path** in each issue body's `## Worktree` section (`.worktrees/track-p2-preset/` / `.worktrees/track-p1-reviewer/` / `.worktrees/track-a-hardener/`) before `git worktree add`. If rename needed, amend issue body via `gh issue edit <n> --body-file` simultaneously.
