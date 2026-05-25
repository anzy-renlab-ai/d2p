# 14 — Protocol-1 Cross-Engine Reviewer Spec (Track P1)

> SPEC-SPLIT artifact, Phase 1. Sibling files:
> [public-surface](./14-protocol-1-public-surface.md) · [tests](./14-protocol-1-tests.md) · [comparison-report](./14-protocol-1-comparison-report.md)

**Phase 1 scope**: this document specifies the cross-engine reviewer protocol AND describes the SDK extraction plan from the current `daemon/src/engines/router.ts` into `core/protocol/cross-engine-reviewer/`. **No code is moved or rewritten in Phase 1.** The SDK extraction itself is Phase 3 work (per lead Phase 3.2 revision).

---

## 1. Goal

Given a `Finding` from Protocol-2, route it through a second LLM engine of a different family from the worker, parse the engine's response into a canonical `Verdict`, and (optionally) request a verified `fix proposal`.

## 2. Non-goals

1. **No engine implementations** — P1 consumes the existing `LLMEngine` abstraction from `core/engines/*` (Phase 3 target; currently `daemon/src/engines/*`). It does not own engine subprocess management, HTTP key handling, retries, or rate-limit accounting.
2. **No preset semantics** — P1 receives a `Finding` and a prompt; it does not interpret `mechanism`, `ruleId`, `severity` beyond passing them through to the critic prompt.
3. **No EvidenceBundle assembly** — P1 produces `VerdictedFinding[]`; the bundling step is Protocol-3 / hardener CLI.
4. **No fix application** — P1 may produce a `FixProposal` artifact but does NOT write to disk. Application is hardener CLI's `--apply` mode.
5. **No verdict aggregation across runs** — there is no "majority vote across last 3 runs" logic. Each invocation produces a fresh verdict.
6. **No confidence score** — verdicts are categorical (`confirmed | false-positive | needs-context | critic-unavailable`). The spec deliberately rejects numeric confidence; the critic LLM is asked for a categorical decision and free-text reasoning, not a number.
7. **No automatic re-route on disagreement** — if the user wants a third opinion, they re-run with a different critic engine pool. P1 does not run "best of N" sampling.

## 3. Public surface

Authoritative shape lives in [14-protocol-1-public-surface.md](./14-protocol-1-public-surface.md). Summary:

- `Verdict` enum: `'confirmed' | 'false-positive' | 'needs-context' | 'critic-unavailable'`.
- `VerdictedFinding` type — `Finding & { verdict, critic, reasoning, requiredContext, version }`.
- `CriticPolicy` type — encapsulates worker engine, critic pool, family classification, and selection result.
- `engineFamily(cfg)` and `pickCriticEngine(worker, pool)` — pure functions (already implemented in `daemon/src/engines/router.ts`; spec'd here for protocol formalization).
- `reviewFinding(finding, ctx, policy, opts?)` — dispatches one finding to the critic, returns one `VerdictedFinding`.
- `reviewBatch(findings, ctx, policy, opts?)` — concurrent per-finding dispatch, default concurrency 5, degrades to serial under cost-cap pressure.
- `proposeFix(finding, ctx, policy, opts?)` — Q4 fix proposal API: returns `FixProposal | null` where `null` means "no LLM-only fix available". The proposal MUST include a `verifyStep` field (Q4 micro: propose + verify in one invocation); proposals without a successful verify get marked `unverified` and hardener CLI MUST refuse to `--apply` them.

All entry points accept an optional `logger: TrackLogger`; default `track='critic'`.

## 4. Internal design

### 4.1 Engine family classification (current behavior)

The existing `daemon/src/engines/router.ts:30` is the reference. Families:

| `EngineConfig.kind` | Family |
|---|---|
| `claude-cli`, `anthropic-api` | `anthropic` |
| `codex-cli` | `openai` |
| `gemini-cli` | `google` |
| `openai-compat` | `URL.hostname.toLowerCase()` of `baseUrl` (so `api.deepseek.com` and `api.minimaxi.chat` are distinct) |

This table is the canonical family taxonomy. Adding a new engine kind requires a P1 minor version bump and an entry here.

### 4.2 Critic selection policy

```
pickCriticEngine(worker, pool) returns CriticPolicy:

  if pool === null or empty:
    critic = worker
    crossFamily = false
    reason = 'no-critic-configured'

  else for each candidate in pool:
    if engineFamily(candidate) !== engineFamily(worker):
      critic = candidate
      crossFamily = true
      reason = 'cross-family-active'
      return

  // every pool member shares worker's family
  critic = pool[0]
  crossFamily = false
  reason = 'same-family-as-worker'
```

When `crossFamily === false`, `reviewFinding`'s default behavior is to short-circuit: return `verdict: 'critic-unavailable'` with `critic: null`. This is Q11 in action.

Override: the caller MAY pass `opts.allowDegraded = true` to force `reviewFinding` to still call `critic` (same-family critic) and produce a real verdict. Hardener CLI never sets this; it is a test affordance + advanced-mode hook.

### 4.3 Verdict pipeline (per finding)

```
reviewFinding(finding, ctx, policy, opts):

  log preset.review.start { findingId, presetId, criticFamily, crossFamily }

  if policy.crossFamily === false and not opts.allowDegraded:
    return { ...finding, verdict: 'critic-unavailable', critic: null, ... }

  prompt = renderCriticPrompt(finding, ctx)       // see §4.4
  response = await policy.critic.callJson(prompt, { schema: VerdictResponseSchema })

  parsedVerdict = response.verdict                 // enforced by schema: confirmed | false-positive | needs-context

  if parsedVerdict === 'needs-context' and (response.requiredContext == null or empty):
    parsedVerdict = 'false-positive'               // empty requiredContext ≡ false-positive (Q1 micro)
    log critic.coerced-empty-context-to-fp { findingId }

  return {
    ...finding,
    verdict: parsedVerdict,
    critic: { engineKind, modelId, releaseDate, family },
    reasoning: response.reasoning,
    requiredContext: parsedVerdict === 'needs-context' ? response.requiredContext : null,
    version: '1.0',
  }
```

On critic invocation failure (transport error, rate limit, schema parse error, timeout):

- Log `critic.invocation-failure { findingId, errorCode, error }`
- Return `verdict: 'critic-unavailable'`, `critic: null`, `reasoning: '<error message>'`, `requiredContext: null`.

`'critic-unavailable'` is never a "secret success"; the caller can always tell from `critic === null`.

### 4.4 Critic prompt template

The prompt rendered for each finding contains:

1. The finding's `message`, `file`, `line`, `evidence`, `presetId`, `ruleId`, `severity`.
2. A windowed snippet of the file (±20 lines around `line`, or whole file if file is ≤500 lines).
3. The preset rule's `rationale` (from `PresetManifest.rules[].rationale` or fallback to `body`).
4. An instruction asking the critic to return a JSON object matching `VerdictResponseSchema`:
   ```json
   {
     "verdict": "confirmed" | "false-positive" | "needs-context",
     "reasoning": "string, ≤500 chars",
     "requiredContext": ["string", ...]  // present iff verdict === 'needs-context'
   }
   ```
5. Few-shot examples of each verdict type (kept short to control prompt cost).

Prompt rendering is a pure function (`renderCriticPrompt(finding, ctx)`) for testability.

### 4.5 Concurrent per-finding dispatch (`reviewBatch`)

```
reviewBatch(findings, ctx, policy, opts):

  concurrency = opts.concurrency ?? 5
  costCap = opts.costCap ?? Infinity
  costSoFar = 0

  results = []
  queue = [...findings]
  active = Set()

  while queue.length or active.size:
    while active.size < concurrency and queue.length and costSoFar < costCap:
      finding = queue.shift()
      promise = reviewFinding(finding, ctx, policy, opts).then(vf => {
        costSoFar += vf.critic ? estimateCost(vf) : 0
        results.push(vf)
      })
      active.add(promise)

    if active.size === concurrency or (queue.length and costSoFar >= costCap):
      await Promise.race([...active])      // race; one finishes
      // when cost cap hit: drain in-flight, then queue (serial after)

    if costSoFar >= costCap and concurrency > 1:
      log critic.cost-cap-throttle { costSoFar, costCap }
      concurrency = 1                       // degrade to serial

  return results
```

This implements Q3 + Q3 micro: default concurrency 5, drop to serial when cost cap pressured (never fail outright).

`estimateCost(vf)` uses the existing `daemon/src/cost/pricing.ts` table. Phase 3 SDK extraction moves this dependency under `core/cost/`.

### 4.6 Fix proposal model (Q4 + Q4 micro)

```typescript
export interface FixProposal {
  findingId:     string;
  proposalKind:  'llm-only';                  // template-based fixes are produced by P2, not here
  patch:         string;                       // unified diff format
  verifyStep:    string;                       // shell command that should fail-after-fix iff finding is gone
  verified:      boolean;                      // true iff verifyStep was run by the critic and passed
  reasoning:     string;
  critic:        { engineKind, modelId, releaseDate, family };
  version:       '1.0';
}
```

`proposeFix(finding, ctx, policy, opts)`:

1. Render the fix-prompt template (asks critic for `{patch, verifyStep, reasoning}`).
2. Call critic.
3. If response is structurally valid (parses as the schema and `patch` is a parseable unified diff):
   - Apply the patch to a temp clone of `ctx.cwd`.
   - In the temp clone, run `verifyStep`. The contract: `verifyStep` should fail (non-zero exit) AFTER the fix is applied IFF the finding is gone. (i.e. it re-runs the original detection. If detection still hits, exit 0. If detection no longer hits, exit non-zero.) This inversion is deliberate so the critic states the verification command in the *finding-detection* sense.
   - If the verify succeeds (i.e. exit code matches the "finding is gone" condition), set `verified: true`.
   - If verify fails (finding still detected after patch) or times out, set `verified: false`.
4. Return the `FixProposal`. Even unverified proposals are returned — the *banner* annotation is hardener CLI's job (Q4 micro: "LLM (unverified)" banner; `--apply` MUST refuse to apply unverified proposals).
5. If the response is structurally invalid (no patch, malformed diff, missing verifyStep), return `null` and log `critic.fix-proposal-invalid`.

### 4.7 Phase 3 SDK extraction plan (informational — not implemented in Phase 1)

Target layout (Phase 3):

```
core/protocol/cross-engine-reviewer/
├── types.ts                      # Verdict, VerdictedFinding, CriticPolicy, FixProposal
├── router.ts                     # engineFamily(), pickCriticEngine() — moved verbatim from daemon/src/engines/router.ts
├── review.ts                     # reviewFinding(), reviewBatch()
├── propose-fix.ts                # proposeFix()
├── prompts/
│   ├── critic-prompt.ts          # renderCriticPrompt()
│   └── fix-proposal-prompt.ts    # renderFixPrompt()
├── schemas.ts                    # VerdictResponseSchema, FixProposalResponseSchema (zod)
└── index.ts                      # surface re-exports
```

Migration order (Phase 3):

1. Move `daemon/src/engines/*` → `core/engines/*` (engine abstraction lift; daemon imports via re-export shim for one cycle).
2. Move `daemon/src/engines/router.ts` → `core/protocol/cross-engine-reviewer/router.ts`.
3. Create new `review.ts`, `propose-fix.ts`, `prompts/`, `schemas.ts` (these are net-new code; current codebase has alignment-probe + behavioral verdict logic in `daemon/src/agents/reviewers.ts` but that operates on diffs, not findings — different domain).
4. Update `daemon/src/engines/registry.ts` to import from `core/protocol/cross-engine-reviewer` for `currentCriticPolicy()`.
5. Delete the per-diff verdict pipeline in `agents/reviewers.ts` (advanced-mode-only; flag as deprecated, do not break advanced mode).

The per-finding pipeline (this protocol) and the per-diff pipeline (advanced mode) MUST coexist during Phase 3. They live in different module trees.

## 5. Failure modes

| Code | Condition | Behavior |
|---|---|---|
| `P1-E-1` | `reviewFinding` invoked with `policy === null` | Throws `P1-E-1: missing CriticPolicy`. |
| `P1-E-2` | Critic invocation transport error (HTTP non-2xx that isn't rate-limit, CLI subprocess exit non-zero, network timeout) | NOT thrown. Returns `verdict: 'critic-unavailable'`, logs `critic.invocation-failure { errorCode: 'P1-E-2' }`. |
| `P1-E-3` | Critic response fails `VerdictResponseSchema` parse (missing `verdict`, unknown enum value, etc.) | NOT thrown. Returns `verdict: 'critic-unavailable'`, logs `critic.response-parse-failure { errorCode: 'P1-E-3', raw: <first 500 chars> }`. |
| `P1-E-4` | Critic returns `verdict: 'needs-context'` with empty `requiredContext` array | Coerced to `verdict: 'false-positive'`, logs `critic.coerced-empty-context-to-fp`. |
| `P1-E-5` | `reviewBatch` cost cap exhausted before all findings reviewed | Returns partial results: findings reviewed so far + remaining findings as `verdict: 'critic-unavailable'` with `critic: null` and `reasoning: 'cost-cap-exhausted'`. Logs `critic.batch-cost-cap-exhausted`. |
| `P1-E-6` | `proposeFix` response missing `patch` or `verifyStep` | Returns `null`. Logs `critic.fix-proposal-invalid`. |
| `P1-E-7` | `proposeFix` patch application to temp clone fails (patch doesn't apply) | Returns proposal with `verified: false` and `reasoning` augmented with `'patch-apply-failed: <err>'`. Logs `critic.fix-proposal-patch-failed`. |
| `P1-E-8` | `proposeFix` verify step times out (default 60s) | Returns proposal with `verified: false`. Logs `critic.fix-proposal-verify-timeout`. |

## 6. Logging Contract

### 6.1 Track name

Default `track: 'critic'`.

### 6.2 Required events

| Event name | Level | When | Required fields |
|---|---|---|---|
| `critic.policy-selected` | `info` | `pickCriticEngine` returns | `workerFamily: string`, `criticFamily: string`, `crossFamily: boolean`, `reason: string` |
| `critic.review.start` | `info` | `reviewFinding` enters | `findingId: string`, `presetId`, `ruleId`, `crossFamily: boolean` |
| `critic.review.success` | `info` | `reviewFinding` returns a verdict (any value) | `findingId`, `verdict: Verdict`, `criticFamily: string \| null`, `durationMs: number` |
| `critic.coerced-empty-context-to-fp` | `warn` | P1-E-4 | `findingId` |
| `critic.invocation-failure` | `error` | P1-E-2 | `findingId`, `errorCode: 'P1-E-2'`, `error: string` |
| `critic.response-parse-failure` | `error` | P1-E-3 | `findingId`, `errorCode: 'P1-E-3'`, `raw: string` (first 500 chars) |
| `critic.batch.start` | `info` | `reviewBatch` enters | `total: number`, `concurrency: number`, `costCap: number \| null` |
| `critic.batch.progress` | `debug` | Every 10 findings or on degrade | `done: number`, `total: number`, `costSoFar: number` |
| `critic.cost-cap-throttle` | `warn` | Concurrency dropped due to cost cap | `costSoFar: number`, `costCap: number` |
| `critic.batch-cost-cap-exhausted` | `error` | P1-E-5 | `remaining: number`, `costSoFar: number`, `costCap: number` |
| `critic.batch.success` | `info` | `reviewBatch` returns | `total: number`, `confirmed: number`, `falsePositive: number`, `needsContext: number`, `criticUnavailable: number`, `durationMs: number` |
| `critic.fix-proposal.start` | `info` | `proposeFix` enters | `findingId`, `presetId`, `ruleId` |
| `critic.fix-proposal.success` | `info` | `proposeFix` returns a non-null `FixProposal` | `findingId`, `verified: boolean` |
| `critic.fix-proposal-invalid` | `warn` | P1-E-6 | `findingId`, `reason: string` |
| `critic.fix-proposal-patch-failed` | `warn` | P1-E-7 | `findingId`, `error: string` |
| `critic.fix-proposal-verify-timeout` | `warn` | P1-E-8 | `findingId`, `timeoutMs: number` |

### 6.3 Required child scopes

| Scope | Used by | Internal events |
|---|---|---|
| `prompt-render` | `renderCriticPrompt` / `renderFixPrompt` | `prompt-render.start`, `prompt-render.success`, `prompt-render.context-window-truncated` |
| `engine-call` | The actual LLM invocation | `engine-call.start`, `engine-call.success`, `engine-call.failure` (engine kind + model id in payload) |
| `fix-verify` | The temp-clone patch-and-verify run in `proposeFix` | `fix-verify.clone-start`, `fix-verify.patch-apply`, `fix-verify.run-verify`, `fix-verify.cleanup` |

### 6.4 Behavior ↔ Log event reverse lookup

| Behavior ID | Log assertion |
|---|---|
| B-1-1 | `pickCriticEngine` with cross-family pool emits `critic.policy-selected` with `crossFamily: true` and `reason: 'cross-family-active'` |
| B-1-2 | `pickCriticEngine` with empty pool emits `critic.policy-selected` with `reason: 'no-critic-configured'` |
| B-1-3 | `pickCriticEngine` with same-family pool emits `critic.policy-selected` with `reason: 'same-family-as-worker'` |
| B-2-1 | `reviewFinding` with `crossFamily: false` and default opts returns `verdict: 'critic-unavailable'` AND logs `critic.review.start` then `critic.review.success` (no engine-call subevents) |
| B-2-2 | `reviewFinding` with valid cross-family policy + mocked critic returning `{verdict: 'confirmed', reasoning: 'x'}` returns `verdict: 'confirmed'` AND logs include `engine-call.start` then `engine-call.success` |
| B-2-3 | `reviewFinding` whose critic returns `{verdict: 'needs-context', requiredContext: []}` returns `verdict: 'false-positive'` AND logs `critic.coerced-empty-context-to-fp` |
| B-2-4 | `reviewFinding` whose critic throws a transport error returns `verdict: 'critic-unavailable'` AND logs `critic.invocation-failure` with `errorCode: 'P1-E-2'` |
| B-2-5 | `reviewFinding` whose critic returns malformed JSON returns `verdict: 'critic-unavailable'` AND logs `critic.response-parse-failure` with `errorCode: 'P1-E-3'` |
| B-3-1 | `reviewBatch([f1...f20])` with default concurrency 5 logs `critic.batch.start` with `concurrency: 5`, then `critic.batch.success` with `total: 20` |
| B-3-2 | `reviewBatch` with `costCap: 0.01` and mocked per-call cost 0.005 logs `critic.cost-cap-throttle` after 2 findings AND processes the rest serially |
| B-3-3 | `reviewBatch` whose cost cap is exhausted mid-batch returns N findings with verdicts + (total-N) findings with `verdict: 'critic-unavailable'` and `reasoning: 'cost-cap-exhausted'` |
| B-4-1 | `proposeFix` whose critic returns a valid `{patch, verifyStep, reasoning}` that applies cleanly and whose verify step "succeeds-meaning-finding-gone" returns a `FixProposal` with `verified: true` |
| B-4-2 | `proposeFix` whose critic returns a patch that fails to apply returns proposal with `verified: false` AND logs `critic.fix-proposal-patch-failed` |
| B-4-3 | `proposeFix` whose verify step times out returns proposal with `verified: false` AND logs `critic.fix-proposal-verify-timeout` |
| B-4-4 | `proposeFix` whose response is missing `verifyStep` returns `null` AND logs `critic.fix-proposal-invalid` |
| B-5-1 | `engineFamily({kind:'openai-compat', baseUrl:'https://api.deepseek.com/v1'})` returns `'api.deepseek.com'` (lowercase hostname, no port, no path) |

## 7. Behaviors

### B-1 — Family classification + policy selection

- **B-1-1** Cross-family pool → `crossFamily: true`, `reason: 'cross-family-active'`.
- **B-1-2** Empty/null pool → `crossFamily: false`, `reason: 'no-critic-configured'`, critic equals worker.
- **B-1-3** Same-family pool → `crossFamily: false`, `reason: 'same-family-as-worker'`.

### B-2 — Single finding review

- **B-2-1** Non-crossFamily policy + default opts → `'critic-unavailable'`, no engine call.
- **B-2-2** Valid policy + critic returning confirmed → `'confirmed'` verdict.
- **B-2-3** Empty `requiredContext` coerced to `'false-positive'`.
- **B-2-4** Critic transport error → `'critic-unavailable'`.
- **B-2-5** Critic malformed JSON → `'critic-unavailable'`.

### B-3 — Batch review under cost pressure

- **B-3-1** Batch with 20 findings + default concurrency → 5-wide parallel dispatch.
- **B-3-2** Cost cap triggers degradation to serial after threshold.
- **B-3-3** Cost cap exhausted produces partial results with explicit `critic-unavailable` for remaining.

### B-4 — Fix proposal + verify

- **B-4-1** Valid response + clean patch + passing verify → `FixProposal.verified === true`.
- **B-4-2** Patch fails to apply → `verified: false`, logs `critic.fix-proposal-patch-failed`.
- **B-4-3** Verify times out → `verified: false`, logs `critic.fix-proposal-verify-timeout`.
- **B-4-4** Response missing `verifyStep` → returns `null`.

### B-5 — `openai-compat` family classification

- **B-5-1** Hostname is taken from `URL(baseUrl).hostname` lowercased; port and path are stripped.

## 8. Dependencies

- **Track L (log module)** — default `logger.track = 'critic'`; all entry points accept optional injection.
- **Protocol-2 (preset framework)** — consumes `Finding` type. Compile-time import only; no runtime call into P2.
- **`core/engines/*`** (Phase 3 target; currently `daemon/src/engines/*`) — `LLMEngine` interface, `EngineConfig`, `pickCriticEngine` returns engine instance; `factory.ts` builds engines.
- **`core/cost/pricing.ts`** (Phase 3 target; currently `daemon/src/cost/pricing.ts`) — `estimateCost` for batch cap accounting.

External: zod (already in `package.json`). No new deps.

---

**Status**: superseded by [`docs/details/14-protocol-1-public-surface.md`](./14-protocol-1-public-surface.md) @ commit `5eee600` (Phase 1.5). This spec is design history only — read public-surface for the authoritative contract.
