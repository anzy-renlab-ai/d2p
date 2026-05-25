# 14 — Protocol-1 Cross-Engine Reviewer Comparison Report

> SPEC-SPLIT step 4: spec vs surface vs tests. Three gap classes:
>
> - **(A)** spec promised, test/Behavior table didn't cover
> - **(B)** test assumed, surface didn't expose
> - **(C)** spec and surface disagree

Subagent attestation: `Files I read: D:\lll\d2p\docs\details\14-protocol-1-public-surface.md, D:\lll\d2p\docs\details\12-log-module-public-surface.md, D:\lll\d2p\docs\details\13-protocol-2-public-surface.md, D:\lll\d2p\CONTEXT.md` — read constraint observed; spec was not opened.

Test doc coverage: 29 test cases across 16 Behavior IDs (B-1-1 through B-5-1; B-2-3 and B-5-1 have 3 tests each). 24/29 (83%) cases carry log assertions. Coverage map complete.

---

## Gap inventory

### Gap B1 — `LLMEngine` method signature undocumented in P1 surface

**Where**: P1 surface §"Core types" imports `LLMEngine` from `core/engines/types` but does not redeclare its shape. Tests writing mocks need to know what P1 actually calls.

**Subagent observation** (§5.12): "A test author following the 'read only the public surface' rule has no idea what shape `LLMEngine` is."

**Class**: (B) — surface gap. The most critical one for testability.

**Resolution**: surface MUST add a "Critic engine call contract" section pinning:

```typescript
// What P1 invokes on the critic engine.
interface MinimalCriticEngineSurface {
  // Returns the raw model response as a string. P1 parses to JSON internally.
  call(prompt: string, opts?: {
    schema?: ZodSchema;   // optional structured-output hint; engine may ignore
    timeoutMs?: number;
  }): Promise<string>;

  // Per-call cost reporting (used by reviewBatch cost-cap accounting).
  // Engines that cannot report cost return null.
  lastCallCostUsd(): number | null;

  // Static metadata accessor; mirrors the EngineConfig fields.
  getMeta(): { engineKind: string; modelId: string; releaseDate: string };
}
```

Add to surface §"Core types" right after `CriticPolicy`. Note: this narrows the dependency from "the full LLMEngine interface" to "the minimal subset Protocol-1 actually calls". Engines implementing more is fine; P1 only needs this subset.

---

### Gap B2 — `EngineMetaSnapshot` provenance unspecified

**Subagent observation** (§5.11): `CriticInfo.modelId` and `releaseDate` — source unclear.

**Class**: (B) — surface gap.

**Resolution**: surface MUST state: "`CriticInfo.engineKind`, `modelId`, `releaseDate` come from `engine.getMeta()` (the new contract in Gap B1). The fields mirror the `EngineConfig` passed at engine construction time; engines do not need to query their backend for these strings." Add as paragraph under §"Core types" `CriticInfo`.

---

### Gap B3 — `track='critic'` vs injected logger's `.track`

**Subagent observation** (§5.15): "What track do events end up under: the injected logger's `.track`, or always `'critic'`?"

**Class**: (B) — surface gap.

**Resolution**: surface MUST state: "When `opts.logger` is supplied, Protocol-1 creates an internal child logger via `opts.logger.child('critic')` to scope its events. This means: `entry.track === opts.logger.track`, `entry.scope === opts.logger.scope ? `${opts.logger.scope}.critic` : 'critic'`. Tests using `captureLogsFor({ track: 'critic' }, ...)` MUST construct the test logger with `track: 'critic'` (e.g. `createTrackLogger('critic')`) so events match. When `opts.logger` is omitted, Protocol-1 creates `createTrackLogger('critic')` and entries land under `track: 'critic'`."

This is the most invasive change but it's the only consistent answer — protocols don't get to override their caller's track.

---

### Gap B4 — `partialFindings` field on P1 errors (vs P2 asymmetry)

**Subagent observation** (§5.10): P2 throws PRESET-E-7 with `partialFindings`; P1's P1-E-5 returns partial-results-in-array. Asymmetric.

**Class**: (B) — surface clarification.

**Resolution**: surface MUST add to §"Error codes" P1-E-5: "Unlike Protocol-2's PRESET-E-7, Protocol-1's `reviewBatch` does NOT throw on cost-cap exhaustion. It returns a complete-length array with `'critic-unavailable'` verdicts for uncompleted findings. No `partialFindings` field on any thrown error in Protocol-1." Also add to "What this surface does NOT promise": "No Protocol-1 entry point throws an error carrying a `partialFindings` field; partial results are always returned as `VerdictedFinding[]` with explicit `'critic-unavailable'` for uncompleted entries."

---

### Gap B5 — Empty / undefined pool fall-through

**Subagent observation** (§5.1): `null` is handled; `[]` and `undefined` are not addressed.

**Class**: (B) — surface gap.

**Resolution**: surface MUST state: "Empty-array pool (`[]`) and undefined pool are treated identically to `null`: `pickCriticEngine` returns `{crossFamily: false, reason: 'no-critic-configured', critic: worker, criticEngine: <built-from-worker-config>}`."

---

### Gap B6 — `allowDegraded: true` under `no-critic-configured` reason

**Subagent observation** (§5.2): does `allowDegraded` invoke the worker as its own critic when pool is null?

**Class**: (B) — surface gap.

**Resolution**: surface MUST state: "`allowDegraded: true` invokes the configured `policy.criticEngine` regardless of `policy.reason`. When `reason: 'no-critic-configured'`, `criticEngine` is built from the worker config — so `allowDegraded: true` effectively asks the worker engine to critic its own findings. This defeats cross-engine decorrelation; use only when no other engine is available."

---

### Gap B7 — Cross-family pick stability when multiple qualify

**Subagent observation** (§5.4): order matters for EvidenceBundle reproducibility.

**Class**: (B) — surface gap.

**Resolution**: surface MUST state: "When multiple pool members are cross-family with the worker, `pickCriticEngine` selects the FIRST cross-family member in array order. This is deterministic: callers control critic preference by ordering their pool config."

---

### Gap B8 — `costCap` boundary semantics

**Subagent observation** (§5.3): when does throttle fire? Before-dispatch or after-completion? `>=` or `>`?

**Class**: (B) — surface gap.

**Resolution**: surface MUST state: "Cost is evaluated AFTER each critic call completes. The throttle fires (concurrency drops to 1) when `costSoFar >= costCap` (inclusive comparison). With `costCap: 0`, the first call still completes (cost evaluated post-call); subsequent calls become serial. Cap exhaustion is also evaluated AFTER each call: if `costSoFar >= costCap` AND queue is non-empty, remaining findings are marked `'critic-unavailable'` with `reasoning: 'cost-cap-exhausted'`."

---

### Gap B9 — `critic.batch.start` `costCap` field for unbounded runs

**Subagent observation** (§5.6): `Infinity` does not JSON-serialize as a number.

**Class**: (B) — surface gap.

**Resolution**: surface MUST state: "When no `costCap` is supplied (or `Infinity`), the `critic.batch.start` event's `costCap` field is `null`. JSON-serialized `Infinity` would become `null` regardless; this contract makes the value explicit."

---

### Gap B10 — P1-E-1 (null policy) log emission

**Subagent observation** (§5.7): synchronous throws — does it log?

**Class**: (B) — surface gap.

**Resolution**: surface MUST state: "P1-E-1 throws synchronously before any logging happens. No log entry is emitted. Caller logs the misuse if desired."

---

### Gap B11 — `reviewBatch([])` empty-input contract

**Subagent observation** (§5.8): not addressed.

**Class**: (B) — surface gap.

**Resolution**: surface MUST state: "`reviewBatch([], ctx, policy, opts)` is a no-op that resolves to `[]`. It emits `critic.batch.start { total: 0 }` and `critic.batch.success { total: 0, confirmed: 0, falsePositive: 0, needsContext: 0, criticUnavailable: 0 }`. The critic engine is not invoked."

---

### Gap B12 — `proposeFix` verify-after-failed-patch ordering

**Subagent observation** (§5.9): does `verifyStep` run when patch fails to apply?

**Class**: (B) — surface gap.

**Resolution**: surface MUST state: "`proposeFix` runs `verifyStep` ONLY AFTER a successful patch apply. If patch application fails, `verifyStep` is never executed; the returned proposal has `verified: false` with the patch error captured in `reasoning`."

---

### Gap B13 — Coerced needs-context: `requiredContext` field shape

**Subagent observation** (§5.5): is the coerced result's `requiredContext` `null` or `[]`?

**Class**: (B) — surface clarification.

**Resolution**: surface MUST state explicitly: "When a `'needs-context'` verdict is coerced to `'false-positive'` (Q1 micro), the resulting `VerdictedFinding.requiredContext === null`. This preserves the invariant `requiredContext: non-empty iff verdict === 'needs-context'`." Already present in the surface §"Verdict response schema" but should be repeated under §"Behavior contract" B-2-3.

---

### Gap B14 — `pickCriticEngine` engine instance pooling

**Subagent observation** (§5.13): does each call construct a fresh engine?

**Class**: (B) — surface gap.

**Resolution**: surface MUST state: "Each `pickCriticEngine` call returns a `CriticPolicy` whose `criticEngine` is a fresh engine instance constructed from the chosen `EngineConfig`. Engine instances are NOT pooled across `pickCriticEngine` calls. Rate-limit and cost state are per-instance; callers wanting shared rate-limit accounting MUST reuse a single `CriticPolicy` across multiple `reviewBatch`/`reviewFinding` calls."

---

### Gap B15 — Retry policy on transport failures

**Subagent observation** (§5.14): does P1 retry internally?

**Class**: (B) — surface gap.

**Resolution**: surface MUST state: "Protocol-1 does NOT retry failed critic calls internally. One transport error → one `'critic-unavailable'` verdict + one `critic.invocation-failure` log entry. Retries are caller responsibility (e.g. the engine adapter MAY implement HTTP-level retry on 429; that is below P1's interface)."

---

## No Type-A or Type-C gaps detected

All Behavior IDs (B-1-1 through B-5-1) have test coverage with ≥2 tests each. Spec §7 and surface §"Behavior contract" agree on Behavior enumerations.

---

## Summary

| Class | Count |
|---|---|
| (A) | 0 |
| (B) | 15 |
| (C) | 0 |

**Total gaps**: 15.

**Fix policy**: all closed in spec + surface before Phase 1 commit. Test doc updated where it currently says "audit item §5.X" to remove the audit notation now that surface answers the question.

Fixes are applied in the same commit as this report.

---

**Status**: Resolutions inlined to surface @ `5eee600` on 2026-05-25. Surface file is now the standalone authoritative contract; this report is historical record only.
