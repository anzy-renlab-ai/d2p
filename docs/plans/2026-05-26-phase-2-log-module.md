# Phase 2 Plan — Log Module Implementation

> DUCKPLAN per CLAUDE.md §2 站台 2. Phase 2 of ZeroU pivot (post-Phase-1.5).
>
> Date: 2026-05-26
> Track: L (log module — single-track, serial, no parallel)
> Surface authority: [docs/details/12-log-module-public-surface.md](../details/12-log-module-public-surface.md) (post-Phase-1.5 patch @ commit `5eee600`)
> Pre-existing companion: `daemon/src/log/sse.ts` (legacy SSE event stream from advanced-mode; not touched by this plan)

---

## Plan

### Files to create (Phase 2 net-new)

**`daemon/src/log/track-logger.ts`** (~280 LOC est) — surface-conformant impl.

Exports (per [surface §Importable symbols](../details/12-log-module-public-surface.md#importable-symbols)):
- `LogLevel`, `LogErrorCode`, `LogEntry`, `TrackLogger`, `CreateTrackLoggerOptions` types
- `LogError extends Error` with `code: LogErrorCode`, `message` starting with code
- `createTrackLogger(track: string, opts?: CreateTrackLoggerOptions): TrackLogger`
- `LOG_SURFACE_VERSION = '1.0' as const`

Internal building blocks (NOT exported):
- `class TrackLoggerImpl implements TrackLogger` — per-instance `WriteStream` (append-only) + `track` + `trace` + optional `scope` + `minLevel`
- `function generateUlid(): string` — Crockford base32, 26 chars, ~40 LOC inline. No `ulid` npm dep (per spec §4.7 + Non-goal #1 "no log shipping" implies zero new deps).
- `function resolveMinLevel(opts): LogLevel` — `opts.minLevel ?? env.ZEROU_LOG_LEVEL ?? 'info'`
- `function rotate(logRoot, track, today, logger): void` — module-level `Set<string>` keys `${pid}|${track}` for per-(process, track) idempotency. Strictly-more-than-7-days cutoff (`localISO < today-7` exclusive). Skipped when `silent || ZEROU_LOG_NULL=1`. Emits `log.rotation-complete` + `log.rotation-failed` meta-events under `track='log'`.
- `function localISODateString(d: Date): string` — `YYYY-MM-DD` in local timezone (per surface "On-disk format" rationale).
- `function safeJSONStringify(obj): string` — `WeakSet` cycle detector + custom replacer; cyclic fields at any depth → string `'[Circular]'` (per surface LOG-E-5 + B-5-2).
- `function validateTrackOrScopeName(name): void` — throws `LogError('LOG-E-3', ...)` if name contains `/` or `\` or starts with `.` or is empty (per surface LOG-E-3 patched scope).
- Module-level state: `liveLoggers: Set<TrackLoggerImpl>` + one-time `process.on('beforeExit', flushAllAndEmitMetaEvent)` hook installed at module load (idempotent guard).
- ENOSPC degraded mode: each `TrackLoggerImpl` carries `degraded: boolean` and `degradedWarned: boolean`. On ENOSPC: drop entry, emit `log.write-degraded` once, set `degraded = true`, write `[degraded] ...` to stderr once. Subsequent writes dropped until `flush()` resolves successfully → flip `degraded = false`.

**`daemon/src/log/test-helpers.ts`** (~80 LOC est) — observer registry + capture API.

Exports:
- `CaptureOptions`, `captureLogsFor<T>(opts, fn): Promise<{result, entries}>`

Internals:
- Module-level `observerRegistry: Map<observerId, { track: string, eventPattern?: RegExp, entries: LogEntry[] }>`
- `captureLogsFor` generates `observerId = ulid()`, inserts observer, emits `log.capture-observer-installed` meta-event (under `track='log'`), runs `fn`, removes observer (try/finally — fires on throw), emits `log.capture-observer-removed`. Re-throws fn's error after cleanup.
- `track-logger.ts` exports a NOT-PART-OF-SURFACE internal hook `notifyObservers(entry: LogEntry)` that `TrackLoggerImpl.log()` calls on every entry that passes level filter (before file write OR meta-event emission). Observers whose `track` matches AND (no `eventPattern` OR `eventPattern.test(entry.event)`) append the entry to their list. Multiple observers see the same entry (per B-4-4).
- Meta-events emitted by `track-logger.ts` (rotation, degraded, invalid-event-name, capture-observer-*, beforeexit-flushed) go through `notifyObservers` too — but they only land in captures whose `opts.track === 'log'` (per B-4-6).

### Files to extend (Phase 2 net-new tests + tests-doc patches)

**`daemon/src/log/track-logger.test.ts`** (~620 LOC est) — implements all 30 test cases in `docs/details/12-log-module-tests.md` PLUS 4 new cases:
- T-7-1-1 + T-7-1-2 (B-7-1 LOG-E-1 first-write thrown on EACCES; both throw)
- T-8-1-1 + T-8-1-2 (B-8-1 LOG-E-2 ENOSPC: dropped entry + stderr warning + `log.write-degraded` event + recovery after `flush()`)

**`daemon/src/log/test-helpers.test.ts`** (~80 LOC est) — sanity tests on `captureLogsFor` itself:
- Observer registry isolation (3 concurrent captures don't cross-talk)
- Always-cleanup on throw / on synchronous error
- Meta-event leak prevention (B-4-6: `track='foo'` capture never sees `log.*` events)
- 5 tests total

**`docs/details/12-log-module-tests.md`** — extend with:
- New §3 entries for T-7-1-1 / T-7-1-2 / T-8-1-1 / T-8-1-2 (4 new test cases)
- New §4 Coverage Map rows for B-7-1 and B-8-1
- New §5 footer: "Surface-claim audit gaps F1-F15 were RESOLVED in surface @ commit `5eee600` (Phase 1.5). This section is historical record; surface is canonical."
- Status footer: "Phase 2 implementation: `daemon/src/log/track-logger.test.ts` covers all 17 behaviors @ commit `<HASH>`. T-7-1 + T-8-1 cases authored during Phase 2."

### Files to create (Phase 2 smoke + sample fixture)

**`scripts/smoke-log-module.mjs`** (~70 LOC est) — onboarding §2.2 requirement.

**Hard constraint** (Windows cross-platform): smoke MUST use `os.tmpdir()` + `path.join()` for the test root. Do NOT hardcode `/tmp/` — Windows git-bash maps `/tmp/` to a different path than Windows-native binaries (the D:\tmp\ incident in Phase 1.5 cost us 4 retry cycles). The probe commands in §Probes and the verify script in §How To Verify also reference `<os-tmpdir>` as a placeholder for the same reason.

Behavior:
- Creates `tmpdir` as `logRoot`.
- `const logger = createTrackLogger('smoke', { logRoot: tmp })`
- `logger.log('info', 'smoke.start', { phase: 'phase-2' })`
- `const child = logger.child('work')`
- `child.log('info', 'smoke.work-step', { step: 1 })`
- `logger.log('info', 'smoke.end', { exit: 0 })`
- `await logger.flush()`
- Read back the JSONL file; assert 3 lines with expected event names + child entry with `scope: 'work'`.
- On success: print `ALL_BEHAVIORS_VERIFIED` to stdout, exit 0.
- On any assertion failure: print failure detail to stderr, exit 1.

### What is NOT in Plan (anti-scope-creep)

- **Do not** touch `daemon/src/log/sse.ts` (legacy advanced-mode; orthogonal to track-logger).
- **Do not** touch `daemon/src/preset/*` / `daemon/src/engines/*` / `cli/*` / any P1/P2/A surface.
- **Do not** move to `core/log/*` (that's Phase 3 SDK extraction; Phase 2 lives at `daemon/src/log/`).
- **Do not** add npm deps (zero-runtime-deps per spec §4.7 + §8).
- **Do not** introduce new `LogLevel` values or `LogErrorCode` values beyond what surface promises.
- **Do not** spec future P3 `bundle.trace_id` plumbing (left for Phase 3 P3 spec).
- **Do not** retroactively rewrite `docs/details/12-log-module-spec.md` to add B-7/B-8 / parentTrace / LogError class. Spec is the design history doc; surface is canonical post-Phase-1.5. If they drift, the comparison-report status footer is the bridge.

---

## Expected Outputs

After Phase 2 done, these artifacts exist on `main`:

### Files

| Path | Est LOC | Status |
|---|---|---|
| `daemon/src/log/track-logger.ts` | ~280 | new |
| `daemon/src/log/test-helpers.ts` | ~80 | new |
| `daemon/src/log/track-logger.test.ts` | ~620 | new |
| `daemon/src/log/test-helpers.test.ts` | ~80 | new |
| `scripts/smoke-log-module.mjs` | ~70 | new |
| `docs/details/12-log-module-tests.md` | +60 lines | extend (4 new T-cases + coverage map + status footer) |

### Commits (≤4, conventional)

1. `test(log): extend tests doc with T-7-1 + T-8-1 cases for B-7-1 + B-8-1` — tests-first per Phase 3 dispatch-notes principle
2. `feat(log): TrackLogger module with per-track JSONL output` — onboarding §2.2 specified commit message verbatim
3. `test(log): captureLogsFor + observer-registry sanity tests`
4. `feat(log): smoke-log-module.mjs sample test (onboarding §2.2 acceptance)`

### Test pass count

**Baseline pre-Phase-2** (verbatim from `npm test --workspace=daemon` on 2026-05-26): **337 tests pass across 45 test files** (duration 9.84s).

Expected increment after Phase 2:
- `daemon/src/log/track-logger.test.ts`: 34 tests (30 existing per `12-log-module-tests.md` Coverage Map + 4 new for B-7-1 + B-8-1)
- `daemon/src/log/test-helpers.test.ts`: 5 tests

**Phase 2 adds 39 tests → post-Phase-2 baseline: 376 tests / 47 test files.** All green, with **100% line coverage** on `daemon/src/log/{track-logger,test-helpers}.ts` (excluding `*.test.ts` files). Branch coverage is NOT promised by this phase per onboarding §2.2 — left for Phase 2.5.

### Real sample log file

After `node scripts/smoke-log-module.mjs` runs:
- File `<tmpdir>/smoke/<YYYY-MM-DD>/<26-char-ULID>.jsonl` exists.
- 3 lines, each one JSON object: events `smoke.start` (root) / `smoke.work-step` (scope=`work`) / `smoke.end` (root). All carry same `trace`. All `level: 'info'`.

---

## How To Verify

A reviewer with a clean clone runs:

```bash
# Setup (vitest configured per daemon/package.json — no new install)
cd daemon && npm install && cd ..

# 1. Run all log module tests
npm test --workspace=daemon -- daemon/src/log/
# expect: "Test Files 2 passed (2)" and "Tests 39 passed (39)"

# 2. Run smoke script
node scripts/smoke-log-module.mjs
# expect-stdout-last-line: "ALL_BEHAVIORS_VERIFIED"
# expect-exit-code: 0

# 3. Verify on-disk sample is real
ls $(node -e 'process.stdout.write(require("os").tmpdir())')/zerou-smoke-*/smoke/$(date +%Y-%m-%d)/*.jsonl
# expect: exactly one file matching the pattern
SAMPLE=$(ls $(node -e 'process.stdout.write(require("os").tmpdir())')/zerou-smoke-*/smoke/$(date +%Y-%m-%d)/*.jsonl | head -1)
jq -c '.event' "$SAMPLE"
# expect (in order):
#   "smoke.start"
#   "smoke.work-step"
#   "smoke.end"

# 4. Verify ULID + trace consistency
jq -r '.trace' "$SAMPLE" | sort -u | wc -l
# expect: 1   (all entries share one trace)

# 5. Verify scope inheritance
jq -c '.scope' "$SAMPLE"
# expect: null, "work", null

# 6. Coverage check
npm test --workspace=daemon -- daemon/src/log/ --coverage
# expect: 100% line + branch on daemon/src/log/track-logger.ts and daemon/src/log/test-helpers.ts
```

Deterministic gate: if step 1 or 2 fails, OR step 3-5 outputs deviate from expected text, OR step 6 coverage < 100% on the two files, reviewer **rejects** Phase 2.

---

## Probes

Used for FEATURE-VALIDATION 1+2+3 (CLAUDE.md §2 site 4) gating Phase 2 ship.

### Probe 1 — Canonical JSONL line shape

```bash
claude --model haiku -p '
Given this Node.js code running on 2026-05-26 in local timezone:

  import { createTrackLogger } from "./daemon/src/log/track-logger.js";
  const logger = createTrackLogger("foo", { logRoot: "<os-tmpdir>/probe1", trace: "01HAAAAAAAAAAAAAAAAAAAAAAA" });
  logger.log("info", "x.y", { a: 1 });
  await logger.flush();

Return the canonical JSON of the single line written to
<os-tmpdir>/probe1/foo/2026-05-26/01HAAAAAAAAAAAAAAAAAAAAAAA.jsonl.

Output ONLY the JSON object, no commentary, no markdown fences. Required fields:
ts (integer, unix ms), level ("info"), track ("foo"), trace
("01HAAAAAAAAAAAAAAAAAAAAAAA"), event ("x.y"), a (1). Field order may vary;
JSON.parse-equality is the contract.
'
```

**Gate 1** (haiku probe) and **Gate 2** (independent `general-purpose` Agent subagent given the same prompt + the patched surface to read) MUST produce JSON that `jq -S` to byte-identical. Both must omit a `scope` field (root logger, no scope) and not invent extra keys.

**Gate 3** (real run): Phase 2 implementation actually executed, `cat <os-tmpdir>/probe1/foo/2026-05-26/01HAAAAAAAAAAAAAAAAAAAAAAA.jsonl | jq -S` produces JSON matching gates 1+2 byte-for-byte on every field EXCEPT `ts` (timestamp non-deterministic; range-checked instead: `(now - 5000) <= ts <= now`).

### Probe 2 — `parentTrace` inheritance contract

```bash
claude --model haiku -p '
Given this Node.js code:

  const cli = createTrackLogger("cli", { logRoot: "<os-tmpdir>/probe2" });
  const critic = createTrackLogger("critic", { logRoot: "<os-tmpdir>/probe2", parentTrace: cli.trace });
  cli.log("info", "audit.start", {});
  critic.log("info", "review.start", {});

Return canonical JSON describing:
  (a) the absolute file path written by cli
  (b) the absolute file path written by critic
  (c) the trace field of the entry in the cli file
  (d) the trace field of the entry in the critic file

Output ONLY this JSON shape:
{ "cliPath": "...", "criticPath": "...", "cliTrace": "...", "criticTrace": "..." }
with cliTrace === criticTrace (parentTrace contract).
'
```

Gate 1+2+3 same protocol. The invariant `cliTrace === criticTrace` is the load-bearing F3-resolved contract. Gate 3 actually constructs both loggers and inspects the trace fields.

---

## Self-checks (worker, before sending plan to lead)

- [x] **Plan section** is specific to file path + function name + behavior — no `// TODO`, no "see code", no "TBD".
- [x] **Expected Outputs** lists files + LOC estimates + commits + test counts + a tangible sample artifact (the JSONL line).
- [x] **How To Verify** is a complete script a reviewer can paste; every step has a deterministic expected output.
- [x] **Probes** has 2 concrete probes covering the most load-bearing surface promises (canonical JSONL shape; `parentTrace` cross-module inheritance).
- [x] Anti-scope-creep list explicit (no src/ outside `daemon/src/log/`, no surface edits, no new deps).
- [x] Tests doc extension is acknowledged as a prerequisite (T-7-x + T-8-x cases) — tests-first per dispatch-notes.
- [x] Acknowledged known design drift: `12-log-module-spec.md` is pre-Phase-1.5; surface is canonical; spec NOT rewritten in Phase 2.
