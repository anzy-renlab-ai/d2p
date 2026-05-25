# Phase 3 Dispatch Notes

Constraints surfaced during Phase 1.5 worker self-report. Lead applies these when dispatching Phase 3 track workers (issues #4 / #5 / #6).

1. **Worker MUST NOT run `/to-prd` after receiving issue.** The issue body IS the PRD. Running `/to-prd` would generate a duplicate.

2. **Worker's FIRST action: extend tests doc.** Authors of new Behavior IDs introduced in Phase 1.5 (`B-7-1/2/3` in P2; `B-10-1..6` in A) MUST add corresponding `T-x-y-z` cases to `docs/details/13-protocol-2-tests.md` / `15-hardener-cli-tests.md` BEFORE writing source. Tests-first; no exceptions.

3. **Lead verifies worktree path** in each issue body's `## Worktree` section (`.worktrees/track-p2-preset/` / `.worktrees/track-p1-reviewer/` / `.worktrees/track-a-hardener/`) before `git worktree add`. If rename needed, amend issue body via `gh issue edit <n> --body-file` simultaneously.

4. **`captureLogsFor` must be wrapped in try/finally.** The observer registry is module-global (`daemon/src/log/track-logger.ts`); an exception inside the captured fn that escapes without try/finally leaks the observer permanently. `captureLogsFor` already does this internally — Phase 3 reviewer rejects any code that calls `__addLogObserver` / `__removeLogObserver` directly without try/finally cleanup.

5. **T-doc vs surface impl-hint precedence**: when a `docs/details/<NN>-<slug>-tests.md` test case contradicts the surface doc's implementation hint, the surface's hint wins. Modify the test, not the impl. Example: log-module B-5-2 — the tests-doc subagent expected outer-cycle `'[Circular]'` marking but surface's "WeakSet + custom JSON replacer" hint produces inner-cycle marking. Phase 2 worker updated the test in `daemon/src/log/track-logger.test.ts`; the test-doc Section 5 audit retains the original ambiguity as historical record.

6. **Vitest command discipline**: when running vitest from the repo root, always pass `--config daemon/vitest.config.ts` (or `cd daemon && npx vitest run --config vitest.config.ts ...`). Bare `npx vitest run` walks up and picks up `ui/tests-e2e/*` producing 90+ false failures. Reviewer-runnable verify commands in plan / issue bodies MUST include the `--config` flag.

7. **Use `os.tmpdir()` in tests + scripts, never hardcode `/tmp/`**. Windows git-bash maps `/tmp/` to a different path than Windows-native binaries (the Phase 1.5 `D:\tmp\issue-p2.md` incident cost 4 retry cycles). All `mkdtemp` calls use `path.join(os.tmpdir(), '<prefix>-')`.

8. **Meta event payload key `subjectTrack` (not `track`)**: surface §"Self-emitted meta-events" payload key for rotation/degraded events is `subjectTrack` (renamed Phase 2 finalize from earlier `track` to avoid collision with the entry's structural `track: 'log'` field; spread order: structural always wins). When Phase 3 Track P1/P2/A code emits meta events about a subject track, use `subjectTrack` in the payload.

9. **Meta-event ordering under cascade failure is non-deterministic**: when a write fails (e.g. stub-rejection-all-writes in tests, real disk full), the meta-logger ITSELF may also degrade and emit its own `log.write-degraded { subjectTrack: 'log' }`. The cascade is bounded (1 level, `degradedWarned` guard) but the ORDER of the foo-track event vs the log-track event is non-deterministic. Phase 3 tests asserting meta-event content under failure cascades MUST use `find` / `some` predicates on `subjectTrack`, NOT positional `[0]` indexing.

10. **Bash tool cwd persists across calls but subprocesses may behave differently**: in Claude Code's Bash tool, `cd <path>` in one call persists into the next call's working directory. But `gh`, `node`, `npm` etc. resolve their own paths against the cwd at command launch. Phase 3 worker SHOULD prefix multi-step bash commands with explicit `cd /d/lll/d2p &&` (or `cd /d/lll/d2p/daemon &&` etc.) rather than relying on persisted cwd from a previous turn.

11. **FEATURE-VALIDATION Probes Gate 1+2+3 byte-identical comparison is SHAPE + INVARIANT**, not literal-value: time-based fields (`ts`, `trace`, ULID) are placeholders in Gate 1/2 predictions and concrete in Gate 3. Comparison via `jq -S` byte-identical applies AFTER normalizing such fields (e.g. `ts → fixed integer`, `trace → placeholder ULID`). The contract being verified is "Gates agree on the SHAPE + the load-bearing INVARIANT (e.g. `cliTrace === criticTrace`)", not "every byte of random output matches".
