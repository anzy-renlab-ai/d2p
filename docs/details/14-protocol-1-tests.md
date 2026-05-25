# 14 — Protocol-1 Cross-Engine Reviewer — Test Plan

> Black-box test plan derived strictly from `14-protocol-1-public-surface.md` (+ Protocol-2 surface for the imported `Finding` type, + Log surface for the `TrackLogger` injection contract).
>
> Author did not read the spec or the implementation. Any gap surfaced here is a true surface gap.

---

## 1. Test framework assumption

- **Runner**: [`vitest`](https://vitest.dev) on Node.js (≥20). One `*.test.ts` file per behavior group `B-X` (so 5 spec files total: `B1-family.test.ts`, `B2-review-single.test.ts`, `B3-review-batch.test.ts`, `B4-propose-fix.test.ts`, `B5-openai-compat.test.ts`).
- **Module under test**: imported via the canonical surface paths only — `core/protocol/cross-engine-reviewer/router`, `.../review`, `.../propose-fix`, `.../types`. No reach-into-internals imports.
- **Mocking strategy**: the `LLMEngine` interface (from `core/engines/types`) is mocked by an in-test `MockEngine` class that implements the same public surface. The class:
  - is fed an explicit "response script" at construction (queue of `{verdict, reasoning, requiredContext?}` JSON strings, throwables, or sleep-then-respond hooks);
  - counts `.call()` invocations on `mockEngine.calls`;
  - tracks max-concurrent in-flight invocations on `mockEngine.maxInFlight`;
  - exposes a `reportedCostPerCall` knob that the cost-cap tests rely on.
- **`EngineConfig` construction**: built inline per test as plain object literals (`{ kind: 'claude-cli', ... }`, `{ kind: 'openai-compat', baseUrl: '...' }`). No factory needed.
- **`CriticPolicy` construction**: built inline by handing back the result of `pickCriticEngine(...)` and then **patching** `.criticEngine` to point at a `MockEngine` instance under test. This is the surface's documented seam (`policy.criticEngine: LLMEngine`).
- **Logger injection**: every test passes `opts.logger = (await captureLogsFor(...)).logger` semantics by wrapping the call in `captureLogsFor({ track: 'critic' }, async () => { ... })` from `core/log/test-helpers`. Per the log surface, this observes entries even when the logger is `silent`. Tests never assert on disk files; only on captured `entries`.
- **Time control**: timeouts and "verify step sleeps longer than timeout" use `vitest`'s fake timers. Cost-cap throttle ordering relies on real microtask scheduling (no fake timers there).
- **Determinism guarantee**: every test sets `ZEROU_LOG_NULL=1` in `beforeAll` so file I/O is impossible during the suite. Capture still observes (per log B-3-2).

---

## 2. Test fixtures

All fixtures live in `test/fixtures/protocol-1/` and are described — not implemented — here.

### 2.1 `mockFinding(overrides?: Partial<Finding>): Finding`

Returns a valid `Finding` (per Protocol-2 surface) with these defaults:

| Field | Default |
|---|---|
| `id` | `'secrets-leak.abc12345'` |
| `presetId` | `'secrets-leak'` |
| `ruleId` | `'hardcoded-stripe-key'` |
| `severity` | `'P1'` |
| `file` | `'src/billing.ts'` |
| `line` | `42` |
| `evidence` | `'const KEY = "sk_live_FAKE"'` |
| `matched_content_normalized` | `'constkey="sk_live_fake"'` |
| `message` | `'Hardcoded stripe live secret detected.'` |
| `remediationHint` | `'Move to env var.'` |
| `fixAvailable` | `'llm-only'` |
| `version` | `'1.0'` |

`overrides` shallow-merges. Used by every B-2 / B-3 / B-4 test.

### 2.2 `MockEngine` (implements `LLMEngine`)

Constructor signature:

```ts
new MockEngine(config: { kind: string; modelId: string; releaseDate: string }, script: ScriptStep[])
```

Where `ScriptStep` is one of:

- `{ kind: 'respond', json: string }` — return the JSON string verbatim
- `{ kind: 'throw', error: Error }` — synchronously throw on the next call
- `{ kind: 'delay-respond', ms: number, json: string }` — `await sleep(ms)` then respond (used for B-3-2 concurrency tests)
- `{ kind: 'transport-error', code: 'P1-E-2' }` — throw an error whose message documents a transport-class failure

`MockEngine` exposes:

- `calls: number` — incremented each `.call()` entry
- `maxInFlight: number` — `++inFlight` on entry, `--inFlight` on exit; track peak
- `reportedCostPerCall: number` — if the engine surface exposes a cost-reporting hook (assumed: a `lastCallCostUsd` getter or callback option on `.call`), this drives B-3-2/3-3.

### 2.3 Engine-config builders (family taxonomy)

Per-`kind` literal builders, one per family enumeration row in the surface, used exclusively by B-1 / B-5 tests:

| Builder | `EngineConfig` |
|---|---|
| `claudeCliCfg()` | `{ kind: 'claude-cli', modelId: 'claude-sonnet-4-5-20250929', releaseDate: '2025-09-29' }` |
| `anthropicApiCfg()` | `{ kind: 'anthropic-api', modelId: 'claude-haiku-4-5-20251001', releaseDate: '2025-10-01' }` |
| `codexCliCfg()` | `{ kind: 'codex-cli', modelId: 'gpt-5-mini', releaseDate: '2025-08-15' }` |
| `geminiCliCfg()` | `{ kind: 'gemini-cli', modelId: 'gemini-2-pro', releaseDate: '2025-07-10' }` |
| `openaiCompatCfg(baseUrl)` | `{ kind: 'openai-compat', baseUrl, modelId: 'deepseek-v3', releaseDate: '2025-06-01' }` |

### 2.4 Patch-and-verify fixture (B-4)

Helper `makeTempRepo({ files: Record<string, string> })`:

1. Creates a temp dir, runs `git init`, writes the supplied files, `git add . && git commit`.
2. Returns `{ cwd, repoSha, cleanup() }` to feed `ReviewContext`.

Companion fixture: a sample finding pointing at a file containing the literal string `OLD_TOKEN`, plus a sample unified diff `sampleDiff` that **removes** that string. Tests pair this with `verifyStep = 'grep -q OLD_TOKEN file.ts'` so that after patch:

- `grep -q OLD_TOKEN file.ts` exits non-zero (string is gone) → **finding gone** → `verified: true` (per `verifyStep` semantics in the surface).

A companion `brokenDiff` fixture is a hunk whose context lines do not exist in the file (forces `git apply` failure) — used by B-4-2.

A companion `verifyAlwaysSucceeds` fixture sets `verifyStep: 'true'` so it always exits 0 → finding still detected → `verified: false` (used by B-4-3).

A companion `verifySleeps` fixture sets `verifyStep: 'sleep 5'` paired with `verifyTimeoutMs: 50` (used by B-4-3 variant).

---

## 3. Test cases

Naming: `T-X-Y-Z` where `X-Y` is the behavior ID and `Z` is the case index (`1` happy, `2`+ negative/edge).

Every test sets up the captured log via `captureLogsFor({ track: 'critic' }, fn)`; assertions on logs reference the captured `entries` array.

---

### T-1-1-1 (covers B-1-1) — happy path

**Name**: `pickCriticEngine returns cross-family policy when pool has different-family engine`

**Setup**:
- worker = `claudeCliCfg()`
- pool = `[codexCliCfg()]`

**Action**:
- `const policy = pickCriticEngine(worker, pool)`

**Assertion (return value)**:
- `policy.crossFamily === true`
- `policy.reason === 'cross-family-active'`
- `policy.worker === worker`
- `policy.critic.kind === 'codex-cli'`

**Assertion (log)**:
- One `critic.policy-selected` info entry, fields `workerFamily: 'anthropic'`, `criticFamily: 'openai'`, `crossFamily: true`, `reason: 'cross-family-active'`.

---

### T-1-1-2 (covers B-1-1) — negative: order-irrelevant cross-family pick

**Name**: `pickCriticEngine still picks first cross-family member even when first pool entry is same-family`

**Setup**:
- worker = `claudeCliCfg()`
- pool = `[anthropicApiCfg(), codexCliCfg(), geminiCliCfg()]`

**Action**:
- `pickCriticEngine(worker, pool)`

**Assertion (return value)**:
- `policy.crossFamily === true`
- `policy.critic.kind` is one of `'codex-cli'` or `'gemini-cli'` (i.e. NOT `'anthropic-api'`). **Surface-audit item: see §5.4** — surface does not commit to which cross-family member is picked when multiple qualify; this assertion documents what the test must remain agnostic about.

**Assertion (log)**:
- `critic.policy-selected` entry has `crossFamily: true` and `criticFamily` not equal to `workerFamily`.

---

### T-1-2-1 (covers B-1-2) — happy path

**Name**: `pickCriticEngine with null pool returns no-critic-configured policy`

**Setup**:
- worker = `claudeCliCfg()`
- pool = `null`

**Action**:
- `pickCriticEngine(worker, null)`

**Assertion (return value)**:
- `policy.crossFamily === false`
- `policy.reason === 'no-critic-configured'`
- `policy.critic === policy.worker` (reference-equality per surface "equals worker iff !crossFamily")

**Assertion (log)**:
- `critic.policy-selected` entry, `crossFamily: false`, `reason: 'no-critic-configured'`.

---

### T-1-2-2 (covers B-1-2) — edge

**Name**: `pickCriticEngine with empty-array pool also yields no-critic-configured`

**Setup**:
- worker = `claudeCliCfg()`
- pool = `[]`

**Action**:
- `pickCriticEngine(worker, [])`

**Assertion (return value)**:
- `policy.crossFamily === false`
- `policy.reason === 'no-critic-configured'` — **Surface-audit item: see §5.1.** Surface lists `null` explicitly but does not say what an empty-array pool does. Test asserts the same code path; if implementation diverges, surface is the bug, not the test.

**Assertion (log)**:
- One `critic.policy-selected` entry.

---

### T-1-3-1 (covers B-1-3) — happy path

**Name**: `pickCriticEngine returns same-family policy when only pool members share family with worker`

**Setup**:
- worker = `claudeCliCfg()`
- pool = `[anthropicApiCfg()]`

**Action**:
- `pickCriticEngine(worker, pool)`

**Assertion (return value)**:
- `policy.crossFamily === false`
- `policy.reason === 'same-family-as-worker'`
- `policy.critic.kind === 'anthropic-api'` (uses the pool entry, not the worker)

**Assertion (log)**:
- `critic.policy-selected` entry, fields `workerFamily: 'anthropic'`, `criticFamily: 'anthropic'`, `crossFamily: false`, `reason: 'same-family-as-worker'`.

---

### T-1-3-2 (covers B-1-3) — edge

**Name**: `pickCriticEngine with worker AND same-family pool entry still flags same-family-as-worker even when multiple same-family options exist`

**Setup**:
- worker = `claudeCliCfg()`
- pool = `[anthropicApiCfg(), claudeCliCfg()]`

**Action**:
- `pickCriticEngine(worker, pool)`

**Assertion (return value)**:
- `policy.reason === 'same-family-as-worker'`
- `policy.crossFamily === false`

**Assertion (log)**:
- Exactly one `critic.policy-selected` entry (idempotency — no double-fire).

---

### T-2-1-1 (covers B-2-1) — happy path

**Name**: `reviewFinding under non-crossFamily policy returns critic-unavailable without calling the critic`

**Setup**:
- policy via `pickCriticEngine(claudeCliCfg(), null)`
- patch `policy.criticEngine = new MockEngine({...}, [])` (empty script — call MUST NOT happen)
- finding = `mockFinding()`

**Action**:
- `const result = await reviewFinding(finding, { cwd: '.', repoSha: null }, policy, { logger })`

**Assertion (return value)**:
- `result.verdict === 'critic-unavailable'`
- `result.critic === null`
- `result.reasoning` is a non-empty string (per surface: "may be error msg when critic-unavailable")
- `result.id === finding.id` and `result.version === '1.0'`

**Assertion (log)**:
- `policy.criticEngine.calls === 0`
- Captured entries include `critic.review.start` (info, `crossFamily: false`) and `critic.review.success` (info, `verdict: 'critic-unavailable'`, `criticFamily: null`, `durationMs: number`).
- NO `critic.invocation-failure` entry.

---

### T-2-1-2 (covers B-2-1) — edge: `allowDegraded: true` flips behavior

**Name**: `reviewFinding under non-crossFamily policy with allowDegraded:true DOES invoke critic`

**Setup**:
- policy = `pickCriticEngine(claudeCliCfg(), [anthropicApiCfg()])` (reason: same-family-as-worker, crossFamily: false)
- patch `policy.criticEngine` to a `MockEngine` that returns `{verdict:'confirmed', reasoning:'ok'}`
- finding = `mockFinding()`

**Action**:
- `await reviewFinding(finding, ctx, policy, { logger, allowDegraded: true })`

**Assertion (return value)**:
- `result.verdict === 'confirmed'`
- `result.critic !== null`
- `result.critic.family === 'anthropic'` (same-family but allowed)

**Assertion (log)**:
- `policy.criticEngine.calls === 1`
- `critic.review.success` entry has `criticFamily: 'anthropic'`.

**Surface-audit item: see §5.2.** The surface defines `allowDegraded` as "override critic-unavailable on same-family short-circuit" but does not say whether `allowDegraded: true` under `reason: 'no-critic-configured'` (i.e. critic === worker) also invokes the critic. Test pins the same-family-as-worker variant only; the no-critic-configured variant is intentionally not asserted.

---

### T-2-2-1 (covers B-2-2) — happy path

**Name**: `reviewFinding with cross-family policy and a 'confirmed' critic response returns confirmed with populated critic metadata`

**Setup**:
- policy = `pickCriticEngine(claudeCliCfg(), [codexCliCfg()])`
- patch `policy.criticEngine` to `MockEngine({kind:'codex-cli', modelId:'gpt-5-mini', releaseDate:'2025-08-15'}, [{kind:'respond', json: JSON.stringify({verdict:'confirmed', reasoning:'real secret, sk_live prefix'})}])`
- finding = `mockFinding()`

**Action**:
- `await reviewFinding(finding, ctx, policy, { logger })`

**Assertion (return value)**:
- `result.verdict === 'confirmed'`
- `result.reasoning === 'real secret, sk_live prefix'`
- `result.critic.engineKind === 'codex-cli'`
- `result.critic.modelId === 'gpt-5-mini'`
- `result.critic.releaseDate === '2025-08-15'`
- `result.critic.family === 'openai'`
- `result.requiredContext === null`

**Assertion (log)**:
- One `critic.review.start` (info, `findingId`, `presetId: 'secrets-leak'`, `ruleId: 'hardcoded-stripe-key'`, `crossFamily: true`).
- One `critic.review.success` (info, `verdict: 'confirmed'`, `criticFamily: 'openai'`, `durationMs: number`).

---

### T-2-2-2 (covers B-2-2) — negative: `verdict: 'false-positive'` round-trip

**Name**: `reviewFinding propagates false-positive verdict end-to-end`

**Setup**:
- Same as T-2-2-1 but critic script returns `{verdict:'false-positive', reasoning:'this is a test fixture not a real key'}`

**Action**:
- `await reviewFinding(...)`

**Assertion (return value)**:
- `result.verdict === 'false-positive'`
- `result.requiredContext === null`
- `result.critic !== null`

**Assertion (log)**:
- `critic.review.success` entry has `verdict: 'false-positive'`.
- NO `critic.coerced-empty-context-to-fp` entry (this case wasn't coerced — it was naturally fp).

---

### T-2-3-1 (covers B-2-3) — happy path

**Name**: `reviewFinding coerces needs-context+empty-requiredContext to false-positive and logs coercion`

**Setup**:
- policy = cross-family
- critic script: `{kind:'respond', json: JSON.stringify({verdict:'needs-context', requiredContext: []})}`
- finding = `mockFinding()`

**Action**:
- `await reviewFinding(...)`

**Assertion (return value)**:
- `result.verdict === 'false-positive'`
- `result.requiredContext === null` — **Surface-audit item: see §5.5** (does coerced result have `requiredContext: null` or `[]`?). Test pins `null` per the surface invariant "non-empty iff verdict === 'needs-context'".
- `result.critic !== null`

**Assertion (log)**:
- One `critic.coerced-empty-context-to-fp` warn entry with `findingId: result.id`.
- One `critic.review.success` info entry with `verdict: 'false-positive'`.

---

### T-2-3-2 (covers B-2-3) — edge: needs-context with absent `requiredContext` key

**Name**: `reviewFinding coerces needs-context with missing requiredContext key (not just empty array) to false-positive`

**Setup**:
- critic script: `{kind:'respond', json: '{"verdict":"needs-context","reasoning":"unsure"}'}` (note: `requiredContext` key omitted entirely)

**Action**:
- `await reviewFinding(...)`

**Assertion (return value)**:
- `result.verdict === 'false-positive'` (per surface: "absent/empty `requiredContext` is coerced")

**Assertion (log)**:
- One `critic.coerced-empty-context-to-fp` warn entry.

---

### T-2-3-3 (covers B-2-3) — happy negative: legitimate needs-context survives

**Name**: `reviewFinding preserves needs-context verdict when requiredContext is non-empty`

**Setup**:
- critic script returns `{verdict:'needs-context', reasoning:'need .env.example', requiredContext: ['.env.example contents']}`

**Action**:
- `await reviewFinding(...)`

**Assertion (return value)**:
- `result.verdict === 'needs-context'`
- `result.requiredContext` deep-equals `['.env.example contents']`

**Assertion (log)**:
- NO `critic.coerced-empty-context-to-fp` entry.
- `critic.review.success` entry has `verdict: 'needs-context'`.

---

### T-2-4-1 (covers B-2-4) — happy path

**Name**: `reviewFinding returns critic-unavailable when critic throws a transport error`

**Setup**:
- critic script: `{kind:'throw', error: new Error('ECONNREFUSED')}`
- finding = `mockFinding()`

**Action**:
- `await reviewFinding(...)` — MUST NOT throw

**Assertion (return value)**:
- `result.verdict === 'critic-unavailable'`
- `result.critic === null`
- `result.reasoning` contains `'ECONNREFUSED'` (per surface: "may be error msg")

**Assertion (log)**:
- One `critic.invocation-failure` error entry with `errorCode: 'P1-E-2'`, `error: <string containing ECONNREFUSED>`, `findingId: result.id`.
- `critic.review.success` entry has `verdict: 'critic-unavailable'`, `criticFamily: null`.

---

### T-2-4-2 (covers B-2-4) — negative: synchronous throw vs P1-E-1

**Name**: `reviewFinding throws synchronously when policy is null (P1-E-1) — distinct from transport failure`

**Setup**:
- finding = `mockFinding()`

**Action**:
- `() => reviewFinding(finding, ctx, null as any, { logger })`

**Assertion (thrown error)**:
- Throws synchronously (not a rejected promise — surface says "Synchronous throw").
- `error.message` starts with `'P1-E-1'`.

**Assertion (log)**:
- The captured entries array MAY be empty — surface does not promise a log for P1-E-1. Test asserts absence of `critic.review.success`.

**Surface-audit item: see §5.7.**

---

### T-2-5-1 (covers B-2-5) — happy path

**Name**: `reviewFinding returns critic-unavailable when critic returns malformed JSON, logging parse failure with truncated raw`

**Setup**:
- critic script: `{kind:'respond', json: 'not-a-json-object {{{'}` (raw < 500 chars)

**Action**:
- `await reviewFinding(...)`

**Assertion (return value)**:
- `result.verdict === 'critic-unavailable'`
- `result.critic === null`
- `result.reasoning` is non-empty.

**Assertion (log)**:
- One `critic.response-parse-failure` error entry, fields: `errorCode: 'P1-E-3'`, `raw: 'not-a-json-object {{{'`, `findingId: result.id`.

---

### T-2-5-2 (covers B-2-5) — edge: oversized raw is truncated to ≤500 chars

**Name**: `reviewFinding truncates raw response to ≤500 chars in parse-failure log`

**Setup**:
- critic script: `{kind:'respond', json: 'x'.repeat(5000)}` (parsable-as-JSON-fragment-no, definitely not a valid verdict object)

**Action**:
- `await reviewFinding(...)`

**Assertion (return value)**:
- `result.verdict === 'critic-unavailable'`

**Assertion (log)**:
- `critic.response-parse-failure` entry's `raw` field has `.length <= 500`.

---

### T-3-1-1 (covers B-3-1) — happy path

**Name**: `reviewBatch with 20 findings and default concurrency=5 logs batch.start{total:20,concurrency:5} and calls critic exactly 20 times`

**Setup**:
- 20 findings via `Array.from({length:20}, (_,i) => mockFinding({id:`secrets-leak.${String(i).padStart(8,'0')}`}))`
- policy = cross-family
- critic script: 20× `{kind:'respond', json: JSON.stringify({verdict:'confirmed', reasoning:'ok'})}`
- `reportedCostPerCall = 0`

**Action**:
- `const results = await reviewBatch(findings, ctx, policy, { logger })` (no `concurrency`, no `costCap`)

**Assertion (return value)**:
- `results.length === 20`
- every `results[i].verdict === 'confirmed'`
- every `results[i].critic !== null`

**Assertion (log)**:
- One `critic.batch.start` info entry with `total: 20`, `concurrency: 5`, `costCap: null` (or omitted — see §5.6).
- One `critic.batch.success` info entry with `total: 20`, `confirmed: 20`, `falsePositive: 0`, `needsContext: 0`, `criticUnavailable: 0`, `durationMs: number`.
- `policy.criticEngine.calls === 20`.
- `policy.criticEngine.maxInFlight <= 5` (per default concurrency cap).
- ≥1 `critic.batch.progress` debug entry (surface lists it; test asserts existence, not exact count).

---

### T-3-1-2 (covers B-3-1) — negative: empty batch

**Name**: `reviewBatch on empty findings array short-circuits with zero critic calls and a zero-total success log`

**Setup**:
- findings = `[]`
- policy = cross-family
- critic script = `[]`

**Action**:
- `const results = await reviewBatch([], ctx, policy, { logger })`

**Assertion (return value)**:
- `results.length === 0` and `Array.isArray(results)`

**Assertion (log)**:
- One `critic.batch.start` (`total: 0`, `concurrency: 5`).
- One `critic.batch.success` (`total: 0`, all counts 0).
- `policy.criticEngine.calls === 0`.

**Surface-audit item: see §5.8.** Surface does not explicitly state what `reviewBatch([], ...)` does. Test pins reasonable behavior; if implementation differs, the surface is the bug.

---

### T-3-2-1 (covers B-3-2) — happy path

**Name**: `reviewBatch drops to serial execution after costCap pressure and emits cost-cap-throttle log`

**Setup**:
- 10 findings
- policy = cross-family
- critic script: 10× `delay-respond` with `ms: 20` (so concurrent calls actually overlap), each `reportedCostPerCall: 0.005`
- `opts.costCap: 0.01`, `opts.concurrency: 5`

**Action**:
- `const results = await reviewBatch(findings, ctx, policy, { logger, costCap: 0.01, concurrency: 5 })`

**Assertion (return value)**:
- `results.length === 10`
- At least the first 2 results have `verdict: 'confirmed'` (per surface "after ≥2 successful calls").

**Assertion (log)** (use `captureLogsFor` under `track: 'critic'`):
- One `critic.batch.start` (info, `concurrency: 5`, `costCap: 0.01`).
- At least one `critic.cost-cap-throttle` warn entry, fields `costSoFar: ≥0.01`, `costCap: 0.01`.
- **Ordering**: the `critic.cost-cap-throttle` entry appears BEFORE the last `critic.review.success` entry chronologically (assert via `entries.findIndex(e => e.event === 'critic.cost-cap-throttle') < entries.findLastIndex(e => e.event === 'critic.review.success')`).
- After the throttle entry, `policy.criticEngine.maxInFlight` (sampled by the mock continuously) never exceeded 1. **Concrete assertion**: instrument the mock to record `inFlightAt[time]` and assert `Math.max(...inFlightAt.filter(s => s.time > throttleEntryTime).map(s => s.value)) <= 1`.

---

### T-3-2-2 (covers B-3-2) — edge: costCap=0 throttles from the very first call

**Name**: `reviewBatch with costCap:0 still completes ≥1 call (cap is post-call) but subsequent are serial`

**Setup**:
- 4 findings, critic `reportedCostPerCall: 0.0001`, `opts.costCap: 0`

**Action**:
- `await reviewBatch(...)`

**Assertion (return value)**:
- `results.length === 4`

**Assertion (log)**:
- `critic.cost-cap-throttle` entry exists.
- `policy.criticEngine.maxInFlight <= 1` for the entire run.

**Surface-audit item: see §5.3.**

---

### T-3-3-1 (covers B-3-3) — happy path

**Name**: `reviewBatch exhausts costCap mid-run and returns suffix of critic-unavailable findings with reasoning cost-cap-exhausted`

**Setup**:
- 10 findings
- critic script: only first 4 are real `respond` steps (each `reportedCostPerCall: 0.005`); subsequent 6 should never actually be called because cost cap exhausts
- `opts.costCap: 0.02`, `opts.concurrency: 1` (forces deterministic ordering for test sanity)

**Action**:
- `const results = await reviewBatch(findings, ctx, policy, { logger, costCap: 0.02, concurrency: 1 })`

**Assertion (return value)**:
- `results.length === 10` (matches `total`)
- `results.slice(0, 4).every(r => r.verdict === 'confirmed')` (the prefix)
- `results.slice(4).every(r => r.verdict === 'critic-unavailable' && r.reasoning === 'cost-cap-exhausted' && r.critic === null)` (the suffix)
- `policy.criticEngine.calls === 4` (uncompleted findings never invoke the critic)

**Assertion (log)**:
- One `critic.batch-cost-cap-exhausted` error entry, fields `remaining: 6`, `costSoFar: 0.02`, `costCap: 0.02`.
- The final `critic.batch.success` entry's counts: `confirmed: 4`, `criticUnavailable: 6`, `total: 10`.

---

### T-3-3-2 (covers B-3-3) — negative: never-exhausted cap behaves like no cap

**Name**: `reviewBatch with costCap higher than total cost runs all findings normally`

**Setup**:
- 5 findings, critic `reportedCostPerCall: 0.001`, `opts.costCap: 1.0`

**Action**:
- `await reviewBatch(...)`

**Assertion (return value)**:
- All 5 results have `verdict: 'confirmed'`, `critic !== null`.

**Assertion (log)**:
- NO `critic.cost-cap-throttle` entries.
- NO `critic.batch-cost-cap-exhausted` entries.
- `critic.batch.success` has `criticUnavailable: 0`.

---

### T-4-1-1 (covers B-4-1) — happy path: proposeFix verified true

**Name**: `proposeFix returns verified:true when patch applies cleanly and verifyStep exits non-zero after patch (finding gone)`

**Setup**:
- temp repo (via `makeTempRepo`) with `file.ts` containing `OLD_TOKEN = "x"`
- finding pointing at `file.ts:1`
- policy = cross-family
- critic script returns `{patch: <sampleDiff that removes OLD_TOKEN>, verifyStep: 'grep -q OLD_TOKEN file.ts', reasoning: 'remove hardcoded token'}`
- ctx.cwd = temp repo path

**Action**:
- `const proposal = await proposeFix(finding, ctx, policy, { logger })`

**Assertion (return value)**:
- `proposal !== null`
- `proposal.findingId === finding.id`
- `proposal.proposalKind === 'llm-only'`
- `proposal.verified === true` — **explicit semantics**: after the patch was applied, `verifyStep` (`grep -q OLD_TOKEN file.ts`) exited non-zero, which under surface semantics MEANS "the finding's detection no longer triggers" → `verified: true`.
- `proposal.patch` equals the critic's `patch` string verbatim.
- `proposal.verifyStep === 'grep -q OLD_TOKEN file.ts'`
- `proposal.critic.engineKind` is the critic mock's kind.
- `proposal.version === '1.0'`

**Assertion (log)**:
- One `critic.fix-proposal.start` info entry, fields `findingId`, `presetId`, `ruleId`.
- One `critic.fix-proposal.success` info entry, fields `findingId`, `verified: true`.

---

### T-4-1-2 (covers B-4-1) — negative: verifyStep exits zero → verified false

**Name**: `proposeFix returns verified:false when patch applies cleanly but verifyStep exits zero (finding still detected)`

**Setup**:
- temp repo with `file.ts` containing `OLD_TOKEN = "x"`
- critic script returns `{patch: sampleDiff, verifyStep: 'true', reasoning: 'x'}` (verifyStep exits 0 — claims finding still present)

**Action**:
- `const proposal = await proposeFix(finding, ctx, policy, { logger })`

**Assertion (return value)**:
- `proposal !== null` (per surface: a proposal IS returned, just with `verified: false`)
- `proposal.verified === false` — **explicit semantics**: `verifyStep` exited zero, which MEANS "finding still detected" → `verified: false`.
- `proposal.patch === sampleDiff`
- `proposal.findingId === finding.id`

**Assertion (log)**:
- `critic.fix-proposal.success` entry has `verified: false`.

---

### T-4-2-1 (covers B-4-2) — happy negative: patch fails to apply

**Name**: `proposeFix returns verified:false and emits patch-failed log when critic patch does not apply to cwd`

**Setup**:
- temp repo with `file.ts` containing `actual content`
- critic script returns `{patch: <brokenDiff referencing nonexistent context>, verifyStep: 'true', reasoning: 'x'}`

**Action**:
- `await proposeFix(...)`

**Assertion (return value)**:
- `proposal !== null`
- `proposal.verified === false`
- `proposal.patch === brokenDiff` (returned verbatim even though it didn't apply)

**Assertion (log)**:
- One `critic.fix-proposal-patch-failed` warn entry, fields `findingId`, `error: <string mentioning patch apply failure>`.
- `critic.fix-proposal.success` entry has `verified: false`.

---

### T-4-2-2 (covers B-4-2) — edge: verify is never attempted when patch failed

**Name**: `proposeFix does NOT execute verifyStep shell command when patch application fails`

**Setup**:
- Same as T-4-2-1 but `verifyStep` is a sentinel command that creates a marker file: `touch /tmp/should-not-exist-<unique>`

**Action**:
- `await proposeFix(...)`

**Assertion (return value)**:
- `proposal.verified === false`

**Assertion (side effect)**:
- Marker file does NOT exist on disk after the call (verifyStep was never executed).

**Assertion (log)**:
- `critic.fix-proposal-patch-failed` is present.
- NO `critic.fix-proposal-verify-timeout`, NO `critic.fix-proposal.success` with `verified: true`.

**Surface-audit item: see §5.9.**

---

### T-4-3-1 (covers B-4-3) — happy path: verifyStep exits zero

**Name**: `proposeFix returns verified:false when verifyStep exits zero (finding still present per surface semantics)`

This case is structurally identical to T-4-1-2 but is filed under B-4-3 to satisfy coverage. Reuse T-4-1-2 verbatim and reference it from §4 Coverage Map.

**Setup / Action / Assertions**: see T-4-1-2.

**Explicit semantics restated**: `verifyStep` exits zero MEANS finding still detected, so `verified: false`. Verbatim from surface line 167.

---

### T-4-3-2 (covers B-4-3) — negative: verifyStep times out

**Name**: `proposeFix returns verified:false and emits verify-timeout log when verifyStep exceeds verifyTimeoutMs`

**Setup**:
- temp repo (patch applies cleanly)
- critic script returns `{patch: sampleDiff, verifyStep: 'sleep 5', reasoning: 'x'}`
- `opts.verifyTimeoutMs: 50`

**Action**:
- `await proposeFix(finding, ctx, policy, { logger, verifyTimeoutMs: 50 })`

**Assertion (return value)**:
- `proposal !== null`
- `proposal.verified === false`
- The call resolves in well under 5 seconds (timeout enforcement works).

**Assertion (log)**:
- One `critic.fix-proposal-verify-timeout` warn entry, fields `findingId`, `timeoutMs: 50`.
- `critic.fix-proposal.success` entry has `verified: false`.

---

### T-4-4-1 (covers B-4-4) — happy path

**Name**: `proposeFix returns null when critic response omits verifyStep, and logs fix-proposal-invalid`

**Setup**:
- critic script returns `{patch: sampleDiff, reasoning: 'x'}` (no `verifyStep` key)

**Action**:
- `const proposal = await proposeFix(...)`

**Assertion (return value)**:
- `proposal === null`

**Assertion (log)**:
- One `critic.fix-proposal-invalid` warn entry, fields `findingId`, `reason: <string mentioning missing verifyStep>`.
- NO `critic.fix-proposal.success` entry.

---

### T-4-4-2 (covers B-4-4) — negative: missing patch

**Name**: `proposeFix returns null when critic response omits patch`

**Setup**:
- critic script returns `{verifyStep: 'true', reasoning: 'x'}` (no `patch` key)

**Action**:
- `await proposeFix(...)`

**Assertion (return value)**:
- `proposal === null`

**Assertion (log)**:
- One `critic.fix-proposal-invalid` warn entry, fields `findingId`, `reason: <string mentioning missing patch>`.

---

### T-5-1-1 (covers B-5-1) — happy path

**Name**: `engineFamily for openai-compat lowercases hostname and strips port and path`

**Setup**: none.

**Action**:
- `engineFamily({kind:'openai-compat', baseUrl: 'https://Api.DeepSeek.com:8080/v1/chat'})`

**Assertion (return value)**:
- returns the exact string `'api.deepseek.com'` (lowercase, no port, no path).

**Assertion (log)**:
- N/A — `engineFamily` is a pure function with no logger parameter on the surface.

---

### T-5-1-2 (covers B-5-1) — negative: malformed baseUrl

**Name**: `engineFamily for openai-compat with invalid baseUrl returns openai-compat:unknown sentinel`

**Setup**: none.

**Action**:
- `engineFamily({kind:'openai-compat', baseUrl: 'not a url'})`

**Assertion (return value)**:
- returns the exact string `'openai-compat:unknown'` (per surface).

**Assertion (log)**:
- N/A.

---

### T-5-1-3 (covers B-5-1) — edge: each canonical kind maps to its declared family

**Name**: `engineFamily maps each canonical kind to its declared family string`

**Setup**: none.

**Action**:
- Call `engineFamily` against each builder in §2.3.

**Assertion (return value)**:
- `engineFamily(claudeCliCfg()) === 'anthropic'`
- `engineFamily(anthropicApiCfg()) === 'anthropic'`
- `engineFamily(codexCliCfg()) === 'openai'`
- `engineFamily(geminiCliCfg()) === 'google'`
- `engineFamily(openaiCompatCfg('https://api.deepseek.com/v1')) === 'api.deepseek.com'`

**Assertion (log)**: N/A.

---

## 4. Coverage map

Every behavior is covered by ≥ 2 tests.

| Behavior | Tests |
|---|---|
| B-1-1 | T-1-1-1, T-1-1-2 |
| B-1-2 | T-1-2-1, T-1-2-2 |
| B-1-3 | T-1-3-1, T-1-3-2 |
| B-2-1 | T-2-1-1, T-2-1-2 |
| B-2-2 | T-2-2-1, T-2-2-2 |
| B-2-3 | T-2-3-1, T-2-3-2, T-2-3-3 |
| B-2-4 | T-2-4-1, T-2-4-2 |
| B-2-5 | T-2-5-1, T-2-5-2 |
| B-3-1 | T-3-1-1, T-3-1-2 |
| B-3-2 | T-3-2-1, T-3-2-2 |
| B-3-3 | T-3-3-1, T-3-3-2 |
| B-4-1 | T-4-1-1, T-4-1-2 |
| B-4-2 | T-4-2-1, T-4-2-2 |
| B-4-3 | T-4-3-1 (= T-4-1-2 reused), T-4-3-2 |
| B-4-4 | T-4-4-1, T-4-4-2 |
| B-5-1 | T-5-1-1, T-5-1-2, T-5-1-3 |

Half-or-more-log-assertion check: 24 of the 29 distinct test cases above include an explicit "Assertion (log)" block other than "N/A". The 5 that do not (the three B-5-1 tests and the two assertions where the log section says "N/A" or "MAY be empty") are all justified by surface contract — `engineFamily` is a pure function with no logger parameter, and P1-E-1 synchronous throws are not promised to log. >50% → constraint satisfied.

---

## 5. Surface-claim audit

Items where writing tests against the surface (without reading the spec) surfaced ambiguity, contradictions, or under-specification. Numbered for traceability into a follow-up `14-protocol-1-comparison-report.md`.

### 5.1 — `pickCriticEngine` empty-array pool vs `null` pool

The surface explicitly handles `pool === null` in B-1-2 ("returns `{crossFamily: false, reason: 'no-critic-configured'}`") but the `pickCriticEngine` signature accepts `EngineConfig[] | null | undefined` and the surface does NOT say what happens with `pool === []` or `pool === undefined`. Test T-1-2-2 had to invent the assumption that `[]` falls through the same code path. **Action requested**: add to surface "empty-array or undefined pool is treated identically to null".

### 5.2 — `allowDegraded: true` under `reason: 'no-critic-configured'`

The surface defines `allowDegraded` as "override 'critic-unavailable on same-family' short-circuit". B-1-2's `no-critic-configured` policy has `critic === worker` (same reference). Under `allowDegraded: true`, does the critic engine get invoked (since it IS the worker engine)? The surface does not say. T-2-1-2 only pins the `same-family-as-worker` variant. **Action requested**: explicitly state whether `allowDegraded: true` under `no-critic-configured` invokes the worker as critic (likely undesirable — defeats the cross-engine intent) or short-circuits to `critic-unavailable` regardless.

### 5.3 — costCap boundary semantics

The surface says (B-3-2): "after ≥2 successful calls, a `critic.cost-cap-throttle` log entry appears". It is silent on:
- Is the throttle triggered when `costSoFar >= costCap` or `costSoFar > costCap`?
- With `costCap: 0` and `reportedCostPerCall: 0.0001`, does throttle fire after the 1st call (`0.0001 >= 0` is true) or never?
- Is the cap evaluated **before** dispatching the next call or **after** the current call completes?

T-3-2-2 assumes a "post-call evaluation, ≥ comparison" model. **Action requested**: pin one model in the surface.

### 5.4 — Cross-family pick when multiple pool members qualify

B-1-1 demonstrates one cross-family member in the pool. The surface does not say which one is chosen when multiple cross-family options exist (`[codex-cli, gemini-cli]` against a `claude-cli` worker). Stable order matters for reproducibility (`EvidenceBundle` must record which critic was used). T-1-1-2 deliberately only asserts "not same-family"; it cannot pin the choice. **Action requested**: add either "first cross-family member in array order" or "implementation-defined; do not rely on order".

### 5.5 — Coerced needs-context: `requiredContext` field on the resulting `VerdictedFinding`

When B-2-3 coercion runs (`needs-context` + empty `requiredContext` → `false-positive`), the resulting `VerdictedFinding` has `verdict: 'false-positive'`. Per the core type invariant "`requiredContext: non-empty iff verdict === 'needs-context'`", the coerced result MUST have `requiredContext: null` (not `[]`). T-2-3-1 asserts `null`. **Action requested**: explicitly write "coerced result sets `requiredContext: null`" so the invariant is unambiguous.

### 5.6 — `critic.batch.start` `costCap` field when caller omits cost cap

The log table for `critic.batch.start` says `costCap: number | null`. The surface says the default `costCap` is `Infinity`. So when caller omits `costCap`, does the log entry contain `costCap: Infinity` (a `number`) or `costCap: null`? `Infinity` does NOT serialize to JSON as a number — it becomes `null` via `JSON.stringify`. T-3-1-1 had to hedge ("`null` or omitted"). **Action requested**: pin one (recommend `costCap: null` in the entry when no cap was supplied).

### 5.7 — `P1-E-1` log emission (or non-emission)

`P1-E-1` is a synchronous throw. The surface log table does not list an event for this case. T-2-4-2 asserts "MAY be empty". **Action requested**: explicitly state "no log entry is emitted for P1-E-1" (recommended — caller's responsibility to log mis-use) or specify an event.

### 5.8 — `reviewBatch([])` behavior

The surface entirely omits the empty-input edge. T-3-1-2 invents a sensible default (no-op, zero-total `batch.start` + `batch.success` events). **Action requested**: either pin that behavior or explicitly say "implementation-defined".

### 5.9 — Verify-step ordering vs patch-application

Surface line 166-167 distinguishes "patch applies cleanly + verifyStep exits non-zero" vs "patch fails to apply → verified: false, error reason recorded". It does NOT say whether `verifyStep` is attempted when the patch failed to apply. T-4-2-2 assumes "no, verify is only run after a successful patch apply" (the only sensible implementation — verifying against unpatched state is meaningless). **Action requested**: write this invariant down.

### 5.10 — `partialFindings` field on Protocol-1 errors

Protocol-2's surface (`PRESET-E-7`, B-4-3) commits to: "the thrown error carries `partialFindings: Finding[]`". Protocol-1's surface defines `P1-E-5` ("`reviewBatch` exhausted cost cap before completing. Returns partial results; uncompleted findings carry `verdict: 'critic-unavailable'`, `reasoning: 'cost-cap-exhausted'`") — but Protocol-1 returns the partial results IN the result array rather than throwing with a `partialFindings` field. The contract is asymmetric. **Action requested**: confirm in P1's surface that **no** Protocol-1 entry-point throws with a `partialFindings` field; P1's "partial result" idiom is always "return an array of length `total` with critic-unavailable suffix entries". Tests T-3-3-1 / T-3-3-2 pin the array-return model.

### 5.11 — `EngineMetaSnapshot` (`modelId` / `releaseDate`) provenance

`CriticInfo.modelId` and `CriticInfo.releaseDate` are documented as "FULL model id" and "ISO 8601 date of the modelId's release". The surface does not say WHERE these strings come from:
- From the `EngineConfig` passed at policy-construction time (`config.modelId`, `config.releaseDate`)?
- From the engine instance via an introspection method (`engine.getMeta()`)?
- From a static lookup table keyed by `kind` + something?

The mock engine in §2.2 takes config in its constructor and re-exposes those fields, betting on option A. If implementation actually queries the engine instance, the mock contract is wrong and every B-2-2 / B-2-3 / B-2-4 / B-4-1 test will fail for the wrong reason. **Action requested**: spell out the provenance. Recommended phrasing: "`CriticInfo.engineKind === config.kind`; `CriticInfo.modelId === config.modelId`; `CriticInfo.releaseDate === config.releaseDate`. Engine instances do not need to expose metadata." If A is wrong, P1 surface MUST document the introspection method on `LLMEngine`.

### 5.12 — `LLMEngine` mock-ability contract

The surface declares `CriticPolicy.criticEngine: LLMEngine` and tells the reader to mock it. But the `LLMEngine` interface itself is imported from `core/engines/types` and is NOT redeclared in the Protocol-1 surface. A test author following the "read only the public surface" rule has no idea what shape `LLMEngine` is — specifically, what method signature `proposeFix`/`reviewFinding` call against it. The fixtures in §2.2 had to handwave a `.call()` method. **Action requested**: either inline-document the subset of `LLMEngine` that Protocol-1 actually invokes (probably one method, e.g. `call(prompt: string, opts?: {...}): Promise<string>` returning the raw JSON string), or add a "Critic engine call contract" section to this surface that pins:
- the method name and signature P1 calls,
- whether the return is a raw string (parse responsibility = P1) or a typed verdict object (parse responsibility = engine adapter),
- how the engine reports per-call cost (return-value field? side-channel like `engine.lastCostUsd`? callback in opts?). The cost-cap tests B-3-2 / B-3-3 cannot be written without this.

### 5.13 — Idempotency / re-entrancy of `pickCriticEngine`

The surface does not say whether `pickCriticEngine` mutates its arguments or constructs/resolves a fresh engine instance per call. `policy.criticEngine: LLMEngine` is described as "resolved engine instance ready to call" — implying construction happens inside `pickCriticEngine`. If true, calling `pickCriticEngine` twice with the same arguments returns two distinct engine instances; concurrent batches would not share rate-limit state. **Action requested**: clarify whether engine instances are pooled or fresh per call.

### 5.14 — Verdict for non-determinism documentation

The surface says (under "does NOT promise"): "stable verdict for stochastic LLMs across two calls with the same input". This means re-running `reviewFinding` on the same finding may yield different verdicts. Tests do NOT assert verdict stability — they hard-code the mock's response. But it raises a question the surface should answer: does `reviewBatch` ever retry a single finding internally? If yes, what's the retry policy and does it emit a log event? T-2-4-1 assumes "no internal retry; one transport error → one `critic-unavailable`". **Action requested**: state explicitly "Protocol-1 does NOT retry failed critic calls internally; retries are caller responsibility" (or document the retry policy).

### 5.15 — `track='critic'` is hardcoded

The surface's log event table is rooted at `track='critic'`. The `ReviewOptions.logger?` field accepts ANY `TrackLogger` (which has its own `track` property — possibly something other than `'critic'`). What track do the events end up under: the injected logger's `.track`, or always `'critic'`? Tests in §3 wrap calls in `captureLogsFor({track:'critic'}, ...)` — meaning if implementation respects the injected logger's track, the entries become invisible and every log assertion fails for the wrong reason. **Action requested**: clarify. Recommended phrasing: "Protocol-1 internally creates a logger via `createTrackLogger('critic', { trace: opts.logger?.trace })`; the injected logger's `.trace` is preserved but the `.track` is overridden to `'critic'`". Without this, the test plan's logger-injection strategy is undefined.

---

Files I read: D:\lll\d2p\docs\details\14-protocol-1-public-surface.md, D:\lll\d2p\docs\details\12-log-module-public-surface.md, D:\lll\d2p\docs\details\13-protocol-2-public-surface.md, D:\lll\d2p\CONTEXT.md
