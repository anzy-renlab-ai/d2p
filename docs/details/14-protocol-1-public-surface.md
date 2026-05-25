# 14 — Protocol-1 Cross-Engine Reviewer Public Surface

> Black-box contract. **Test doc authors MUST read only this file**, not the spec.

---

## Surface version

```typescript
export const REVIEWER_PROTOCOL_VERSION = '1.0' as const;
```

## Core types

```typescript
// from "core/protocol/cross-engine-reviewer/types"

import type { Finding } from "core/protocol/preset/types";   // Protocol-2 surface
import type { EngineConfig, LLMEngine } from "core/engines/types";

export type Verdict =
  | 'confirmed'
  | 'false-positive'
  | 'needs-context'
  | 'critic-unavailable';

export interface CriticInfo {
  engineKind:  string;     // e.g. 'anthropic-api'
  modelId:     string;     // e.g. 'claude-haiku-4-5-20251001'  (FULL model id, per Q5 micro)
  releaseDate: string;     // ISO 8601 date of the modelId's release, e.g. '2025-10-01'
  family:      string;     // see family taxonomy below
}

export interface VerdictedFinding extends Finding {
  verdict:           Verdict;
  critic:            CriticInfo | null;     // null iff verdict === 'critic-unavailable'
  reasoning:         string | null;         // free text, may be error msg when critic-unavailable
  requiredContext:   string[] | null;       // non-empty iff verdict === 'needs-context'
  version:           '1.0';
}

export interface CriticPolicy {
  worker:      EngineConfig;
  critic:      EngineConfig;                // equals worker iff !crossFamily
  criticEngine: LLMEngine;                  // resolved engine instance ready to call
  crossFamily: boolean;
  reason:      'cross-family-active' | 'no-critic-configured' | 'same-family-as-worker';
}

export interface FixProposal {
  findingId:     string;
  proposalKind:  'llm-only';
  patch:         string;                     // unified diff
  verifyStep:    string;                     // shell command; semantics: should fail-meaning-finding-gone after patch
  verified:      boolean;
  reasoning:     string;
  critic:        CriticInfo;
  version:       '1.0';
}
```

## Entry points

```typescript
// from "core/protocol/cross-engine-reviewer/router"

export function engineFamily(cfg: EngineConfig): string;
export function pickCriticEngine(worker: EngineConfig, pool?: EngineConfig[] | null): CriticPolicy;
```

```typescript
// from "core/protocol/cross-engine-reviewer/review"

export interface ReviewContext {
  cwd:           string;
  repoSha:       string | null;
  /** Read the audited file's contents (the impl supplies a default that reads from disk). */
  readFile?:     (path: string) => Promise<string>;
}

export interface ReviewOptions {
  logger?:        TrackLogger;
  /** Override "critic-unavailable on same-family" short-circuit (default: false). */
  allowDegraded?: boolean;
}

export function reviewFinding(
  finding:  Finding,
  ctx:      ReviewContext,
  policy:   CriticPolicy,
  opts?:    ReviewOptions,
): Promise<VerdictedFinding>;

export interface BatchOptions extends ReviewOptions {
  /** Concurrent in-flight critic calls. Default: 5. */
  concurrency?: number;
  /** Stop spending after this USD threshold. Default: Infinity. */
  costCap?:     number;
}

export function reviewBatch(
  findings: Finding[],
  ctx:      ReviewContext,
  policy:   CriticPolicy,
  opts?:    BatchOptions,
): Promise<VerdictedFinding[]>;
```

```typescript
// from "core/protocol/cross-engine-reviewer/propose-fix"

export interface ProposeFixOptions extends ReviewOptions {
  /** Override the 60-second default verify timeout. */
  verifyTimeoutMs?: number;
}

export function proposeFix(
  finding:  Finding,
  ctx:      ReviewContext,
  policy:   CriticPolicy,
  opts?:    ProposeFixOptions,
): Promise<FixProposal | null>;
```

## Family taxonomy

`engineFamily(cfg)` returns one of:

| `cfg.kind` | Returns |
|---|---|
| `claude-cli` | `'anthropic'` |
| `anthropic-api` | `'anthropic'` |
| `codex-cli` | `'openai'` |
| `gemini-cli` | `'google'` |
| `openai-compat` | lowercase `URL(cfg.baseUrl).hostname` (no port, no path); invalid URL → `'openai-compat:unknown'` |

Two engines share a family iff `engineFamily` returns the same string for both. The cross-family check in `pickCriticEngine` is pure string equality.

## Verdict response schema (critic LLM contract)

The critic engine is asked to return a JSON object that strictly conforms to:

```typescript
{
  verdict:          'confirmed' | 'false-positive' | 'needs-context',
  reasoning:        string,                  // ≤500 chars
  requiredContext?: string[]                 // REQUIRED iff verdict === 'needs-context', else MUST be absent or empty
}
```

- A response with `verdict: 'needs-context'` and absent/empty `requiredContext` is coerced to `verdict: 'false-positive'` (per Q1 micro: "empty `requiredContext` ≡ `false-positive`").
- The fourth Verdict value, `'critic-unavailable'`, is NEVER produced by the critic itself — it is assigned by the framework when the critic could not be reached or its response could not be parsed.

## Fix proposal response schema

```typescript
{
  patch:       string,                   // unified diff format
  verifyStep:  string,                   // shell command
  reasoning:   string                    // ≤500 chars
}
```

`verifyStep` semantics (Q4 micro): the command, when run in a clone with the patch applied, should exit non-zero IFF the original finding's detection no longer triggers. `proposeFix` interprets:

- Patch applies cleanly + `verifyStep` exits non-zero within `verifyTimeoutMs` → `verified: true`.
- Patch applies cleanly + `verifyStep` exits zero (finding still detected) → `verified: false`.
- Patch fails to apply → `verified: false`, error reason recorded.
- `verifyStep` times out → `verified: false`.
- Response missing `patch` or `verifyStep` → `proposeFix` returns `null`.

## Error codes

| Code | Trigger |
|---|---|
| `P1-E-1` | `reviewFinding` called with `policy === null/undefined`. Synchronous throw. |
| `P1-E-2` | Critic invocation transport error (HTTP non-2xx that isn't rate-limit-with-retry, CLI subprocess non-zero exit, network timeout). NOT thrown; returns `verdict: 'critic-unavailable'`. |
| `P1-E-3` | Critic response fails schema parse. NOT thrown; returns `verdict: 'critic-unavailable'`. |
| `P1-E-4` | Critic returns `verdict: 'needs-context'` with empty/missing `requiredContext`. Coerced to `'false-positive'`; logged. |
| `P1-E-5` | `reviewBatch` exhausted cost cap before completing. Returns partial results; uncompleted findings carry `verdict: 'critic-unavailable'`, `reasoning: 'cost-cap-exhausted'`. |
| `P1-E-6` | `proposeFix` response missing `patch` or `verifyStep`. Returns `null`. |
| `P1-E-7` | `proposeFix` patch application failed. Returns proposal with `verified: false`. |
| `P1-E-8` | `proposeFix` verify step timed out. Returns proposal with `verified: false`. |

## Behavior contract

### B-1 — Family classification + policy selection

- **B-1-1** With worker `{kind:'claude-cli'}` and pool `[{kind:'codex-cli'}]`, `pickCriticEngine` returns `{crossFamily: true, reason: 'cross-family-active', critic: <codex>}`.
- **B-1-2** With worker `{kind:'claude-cli'}` and pool `null`, `pickCriticEngine` returns `{crossFamily: false, reason: 'no-critic-configured', critic === worker}`.
- **B-1-3** With worker `{kind:'claude-cli'}` and pool `[{kind:'anthropic-api'}]` (same family), `pickCriticEngine` returns `{crossFamily: false, reason: 'same-family-as-worker', critic: <anthropic-api>}`.

### B-2 — Single finding review

- **B-2-1** A finding reviewed under a `crossFamily: false` policy with default `opts` returns `verdict: 'critic-unavailable'`, `critic: null`. No critic engine call is made (test asserts the critic mock was never invoked).
- **B-2-2** A finding reviewed under a `crossFamily: true` policy where the critic mock returns `{verdict:'confirmed', reasoning:'x'}` returns `verdict: 'confirmed'`, `reasoning: 'x'`, `critic.engineKind === <mock kind>`, `critic.modelId` and `critic.releaseDate` populated.
- **B-2-3** Critic returns `{verdict:'needs-context', requiredContext: []}` → result has `verdict: 'false-positive'`, AND a `critic.coerced-empty-context-to-fp` log entry is recorded.
- **B-2-4** Critic mock throws a non-rate-limit transport error → result has `verdict: 'critic-unavailable'`, `critic: null`, AND a `critic.invocation-failure` log entry with `errorCode: 'P1-E-2'`.
- **B-2-5** Critic mock returns a string that is not valid JSON → result has `verdict: 'critic-unavailable'`, AND a `critic.response-parse-failure` log entry with `errorCode: 'P1-E-3'` AND a `raw` field of ≤500 chars.

### B-3 — Batch review

- **B-3-1** `reviewBatch([20 findings])` with default `concurrency: 5` logs `critic.batch.start { concurrency: 5, total: 20 }` and `critic.batch.success { total: 20 }`. Test may inspect mock-engine call count and verify it equals 20 (one per finding).
- **B-3-2** `reviewBatch` with `costCap: 0.01` against a mock that reports per-call cost 0.005: after ≥2 successful calls, a `critic.cost-cap-throttle` log entry appears and remaining calls happen serially (test asserts concurrent in-flight count never exceeds 1 after throttle).
- **B-3-3** `reviewBatch` with a cost cap that exhausts mid-batch: returns an array of length `total`, where the prefix is verdicted findings and the suffix carries `verdict: 'critic-unavailable'`, `reasoning: 'cost-cap-exhausted'`.

### B-4 — Fix proposal + self-verification

- **B-4-1** `proposeFix` with a mock critic returning `{patch: '<valid diff>', verifyStep: 'grep -q OLD file', reasoning: 'x'}` against a temp clone where applying the patch removes the OLD pattern: returns `FixProposal` with `verified: true`.
- **B-4-2** `proposeFix` with a patch that does not apply to `ctx.cwd` returns `FixProposal` with `verified: false`, AND a `critic.fix-proposal-patch-failed` log entry.
- **B-4-3** `proposeFix` with a verify step that exits 0 (finding still detected after patch) returns `FixProposal` with `verified: false`. (Test variant: `verifyStep` that sleeps longer than `verifyTimeoutMs` returns `verified: false` AND a `critic.fix-proposal-verify-timeout` log entry.)
- **B-4-4** `proposeFix` whose critic response omits `verifyStep` returns `null`, AND a `critic.fix-proposal-invalid` log entry.

### B-5 — `openai-compat` family

- **B-5-1** `engineFamily({kind:'openai-compat', baseUrl:'https://Api.DeepSeek.com:8080/v1/chat'})` returns `'api.deepseek.com'`.

## Self-emitted log events under `track='critic'`

| Event | Level | Required fields |
|---|---|---|
| `critic.policy-selected` | `info` | `workerFamily`, `criticFamily`, `crossFamily: boolean`, `reason: string` |
| `critic.review.start` | `info` | `findingId`, `presetId`, `ruleId`, `crossFamily: boolean` |
| `critic.review.success` | `info` | `findingId`, `verdict: Verdict`, `criticFamily: string \| null`, `durationMs: number` |
| `critic.coerced-empty-context-to-fp` | `warn` | `findingId` |
| `critic.invocation-failure` | `error` | `findingId`, `errorCode: 'P1-E-2'`, `error: string` |
| `critic.response-parse-failure` | `error` | `findingId`, `errorCode: 'P1-E-3'`, `raw: string` |
| `critic.batch.start` | `info` | `total: number`, `concurrency: number`, `costCap: number \| null` |
| `critic.batch.progress` | `debug` | `done: number`, `total: number`, `costSoFar: number` |
| `critic.cost-cap-throttle` | `warn` | `costSoFar: number`, `costCap: number` |
| `critic.batch-cost-cap-exhausted` | `error` | `remaining: number`, `costSoFar: number`, `costCap: number` |
| `critic.batch.success` | `info` | `total: number`, `confirmed: number`, `falsePositive: number`, `needsContext: number`, `criticUnavailable: number`, `durationMs: number` |
| `critic.fix-proposal.start` | `info` | `findingId`, `presetId`, `ruleId` |
| `critic.fix-proposal.success` | `info` | `findingId`, `verified: boolean` |
| `critic.fix-proposal-invalid` | `warn` | `findingId`, `reason: string` |
| `critic.fix-proposal-patch-failed` | `warn` | `findingId`, `error: string` |
| `critic.fix-proposal-verify-timeout` | `warn` | `findingId`, `timeoutMs: number` |

Child scopes used: `prompt-render`, `engine-call`, `fix-verify`.

## What this surface does NOT promise

- It does not promise stable verdict for stochastic LLMs across two calls with the same input. Verdicts may differ run-to-run.
- It does not promise patch-text format beyond "parseable unified diff". Caller normalizes line endings if needed.
- It does not promise the temp clone strategy for `proposeFix` is filesystem-efficient (it copies the relevant subset; full repo clone is not required but may happen).
- It does not promise `engineFamily` is stable across SDK versions for hostnames hosting multiple providers (DeepSeek hosting Anthropic-trained models, etc.). Family is structural, not semantic.
