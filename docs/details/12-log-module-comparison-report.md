# 12 — Log Module Comparison Report

> SPEC-SPLIT step 4: compare what `12-log-module-spec.md` promises, what `12-log-module-public-surface.md` exposes, and what `12-log-module-tests.md` (written by an independent subagent reading ONLY the surface) was able to specify. Three gap classes:
>
> - **(A)** spec promises a behavior but the test doc didn't cover it
> - **(B)** test author assumed something the surface didn't expose (surface contract gap — most valuable)
> - **(C)** spec and surface disagree

Subagent attestation: `Files I read: D:\lll\d2p\docs\details\12-log-module-public-surface.md, D:\lll\d2p\CONTEXT.md` — read constraint observed; spec was not opened.

Test doc coverage: 30 test cases across 15 Behavior IDs (2+ per ID). 18/30 (60%) cases carry `Assertion (log)` blocks using `captureLogsFor`. Coverage map complete.

---

## Gap inventory

### Gap A1 — spec lists `LOG-E-1` (logRoot not writable) and `LOG-E-2` (disk full) but no `B-X-Y` Behavior covers them

**Where**: spec §5 lists `LOG-E-1` and `LOG-E-2`; spec §7 Behaviors enumerate B-1 through B-6 with no entry for these error paths.

**Subagent observation**: "no behavior listed in the B-X-Y table covers LOG-E-1 … no `B-X-Y` covers [LOG-E-2]; `log.write-degraded` is mentioned … but there is no behavior contract pairing the stderr warning + drop + recovery semantics with a verifiable observation."

**Class**: (A) — spec promises, behavior contract incomplete.

**Resolution**: add `B-7` to spec + surface covering `LOG-E-1` (logRoot EACCES throw on first write) and `B-8` covering `LOG-E-2` (disk full degraded mode: drop + one stderr warn + drop until flush succeeds). Update Behavior↔Log reverse lookup table.

---

### Gap B1 — empty-string scope (`root.child('')`) behavior undefined

**Subagent observation**: T-1-3-2 must accept either `scope: ''` OR a thrown exception because surface doesn't say.

**Class**: (B) — surface gap.

**Resolution**: surface MUST decide. Pick: `child('')` throws synchronously (similar to LOG-E-3 for track names) — invalid scope. Add to error table as `LOG-E-3-scope` (scope name validation parallel to track validation).

Actually, simpler: tighten the constraint by extending LOG-E-3 to cover both track and scope names. Spec already enforces this rule for track names; extend to scope.

---

### Gap B2 — `captureLogsFor` returned `entries` ordering unspecified

**Subagent observation**: surface doesn't say chronological vs insertion vs unordered. T-6-1-1 had to soften to set equality.

**Class**: (B) — surface gap.

**Resolution**: surface MUST promise chronological order (FIFO by `.log()` call time on the calling thread). Add to surface section "Behavior contract" and to Section "What this surface does NOT promise" (negate the case for cross-thread order if Node ever gains worker `log()` calls).

---

### Gap B3 — error class not specified (only "message starts with code")

**Subagent observation**: tests using `expect(...).toThrow(LogError)` cannot be written.

**Class**: (B) — surface gap.

**Resolution**: surface MUST specify `Error` subclass with a `code: string` property: `class LogError extends Error { code: 'LOG-E-1' | ... }`. Update surface error table to declare the class.

---

### Gap B4 — `<today>` date format / timezone unspecified

**Subagent observation**: "is it UTC or local? Surface says 'local date' but doesn't specify the locale's date-boundary semantics."

**Class**: (B) — surface gap (and spec is equally vague).

**Resolution**: spec + surface MUST decide. Pick: **local time** (matches the operator's mental model when grepping `ls .zerou/logs/foo/`), format `YYYY-MM-DD` (ISO calendar date, not ISO 8601 datetime). DST behavior: a logger constructed at 2026-03-08 02:30 local during a DST forward shift uses date string `2026-03-08`. Document under spec §4.1 and surface "On-disk format".

---

### Gap B5 — `[Circular]` substitution depth unspecified (shallow vs deep)

**Subagent observation**: T-5-2-2 picks deep replacement; surface doesn't pin it.

**Class**: (B) — surface gap.

**Resolution**: surface MUST specify **deep** substitution — any cycle at any depth is replaced. Implementation hint: use a `WeakSet` + custom JSON replacer. Surface promise: "any field that is part of a cycle is serialized as the string `'[Circular]'`; non-cyclic fields at any depth serialize normally."

---

### Gap B6 — `removedDirs` path format (absolute vs relative)

**Subagent observation**: T-2-1-1 assumes absolute; surface doesn't say.

**Class**: (B) — surface gap.

**Resolution**: surface MUST specify absolute paths. Add to surface "Self-emitted meta-events" payload column: `removedDirs: string[] (absolute paths)`.

---

### Gap B7 — rotation cutoff inclusive/exclusive

**Subagent observation**: directory dated exactly 7 days ago — kept or removed?

**Class**: (B) — surface gap.

**Resolution**: surface MUST specify: **a directory whose date string is strictly more than 7 days before today is removed**. Directories ≤7 days old are kept. Concrete: today `2026-05-25`, kept range `[2026-05-18, 2026-05-25]` (8 days inclusive); `2026-05-17` and older are removed.

---

### Gap B8 — `silent: true` + rotation interaction

**Subagent observation**: "do silent loggers still run rotation? B-2-1 doesn't say. If yes, T-3-2-1's 'directory does not exist' assertion is wrong."

**Class**: (B) — surface gap with a logical conflict.

**Resolution**: spec + surface MUST clarify: **`silent: true` AND `ZEROU_LOG_NULL=1` skip rotation entirely** (no directory scanning, no removal). The contract: silent loggers touch no filesystem. This aligns with the intent of `silent: true` for tests.

---

### Gap B9 — `process.beforeExit` flush meta-event

**Subagent observation**: contract observable only via file-system inspection; no `log.beforeexit-flushed` meta-event listed.

**Class**: (B) — surface gap.

**Resolution**: add `log.beforeexit-flushed` meta-event to spec §6.2 + surface "Self-emitted meta-events". Payload: `flushedCount: number, durationMs: number`.

---

### Gap B10 — meta-events leaking into application-track captures

**Subagent observation**: "explicit confirmation would let tests assert 'no meta-events leak into application-track captures'."

**Class**: (B) — surface clarification needed.

**Resolution**: surface MUST state: "meta-events emitted by the log module are always written under `track: 'log'`. They never appear in another track's captures (`captureLogsFor({ track: 'foo' }, …)` will not return `log.*` events)."

---

### Gap B11 — nested `captureLogsFor` observer visibility

**Subagent observation**: "Are observers visible to other observers?"

**Class**: (B) — surface gap.

**Resolution**: surface MUST state: "concurrent and nested `captureLogsFor` calls each receive every entry written during their `fn`'s execution that matches their filters. Observers do not consume entries — multiple observers can see the same entry. The same entry is also written to disk (unless `silent: true`)."

This matches Section "Behavior contract" → B-4-2 implicit but explicit verbiage is missing.

---

### Gap B12 — rotation "per-process" semantics under test workers

**Subagent observation**: vitest's `--threads`/`--isolate` modes — module-level Set, process.env, or file lock?

**Class**: (B) — surface gap.

**Resolution**: surface MUST state: "rotation runs at most once per (Node process, track) pair, tracked via a module-level Set. Each vitest worker thread is its own Node process and runs rotation independently."

---

### Gap B13 — `caller: string (best-effort)` looseness

**Subagent observation**: "Without a stronger contract, the test in T-5-1-1 is the weakest possible assertion."

**Class**: (B) — accepted as-is.

**Resolution**: no change. "Best-effort" is an intentional contract — the implementation may use `Error().stack` parsing and frame format varies by Node version. Tests assert `typeof caller === 'string' && caller.length > 0` only. Document this explicitly under surface "What this surface does NOT promise".

---

## No Type-C gaps detected

Spec §7 (Behaviors) and surface §"Behavior contract" enumerate the same B-1-1 through B-6-2 IDs with consistent semantics. No place where spec and surface disagree was identified. The discrepancies are all surface-incompleteness (Type B) or behavior-contract-incompleteness in both (Type A).

---

## Summary

| Class | Count |
|---|---|
| (A) spec promised, test/Behavior table didn't cover | 1 (LOG-E-1 + LOG-E-2 missing B-X-Y) |
| (B) test assumed, surface didn't expose | 12 |
| (C) spec and surface disagree | 0 |

**Total gaps**: 13.

**Fix policy**:
- All Type A and Type B (except B13) gaps MUST be closed in spec + surface before Phase 1 commit.
- B13 is accepted as documented intentional looseness.

**Fixes are applied in the same commit as this report** — spec, surface, and (where the test author's wording is now wrong) test doc all updated. The updated test doc will reflect the now-decided answers (e.g. T-1-3-2 will be rewritten to assert that `child('')` throws, not "either-or").

---

**Status**: Resolutions inlined to surface @ `5eee600` on 2026-05-25. Surface file is now the standalone authoritative contract; this report is historical record only.
