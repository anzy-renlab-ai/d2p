# Phase 11.1 — Parallelize Audit (p-limit + retry/backoff)

> A real Next.js + Drizzle dogfood took 39 minutes; 96.5% of wall-clock was
> awaiting a single LLM HTTP response. Wire `--concurrency` (parsed but
> ignored) through generator / runner / emitter, add exponential-backoff
> retries on 429 + 5xx.

---

## Goal

Per `docs/reviews/2026-05-27-audit-parallelization.md`, the audit on
`meme-weather-zerou-test` (trace `01KSM5CGZZC9VAVXB43JNB14Q7`) decomposed:

| Phase | Iterations | Wall time |
|---|---|---|
| test-gen | 13 targets | 5.0 min |
| test-run | 33 specs | 8.7 min |
| emit | 36 specs × 12 files | 24.7 min |
| **Total agent loop** | | **38.3 min (96.5% of clock)** |

Each phase did `for spec of …; await llm()`. CPU idle. Discovery: the audit
CLI already accepted `--concurrency 5` and never threaded it anywhere
(`cli/src/audit.ts:89`). And there was no retry layer — visible 30s
timeouts in `agent.test-run.case.llm-call.failure` were pure dead time.

Phase 11.1 fixes both with the smallest possible surface: one shared
`p-limit` pool helper, one shared `fetchLlm` retry/backoff helper, refactor
the four duplicate OpenAI-compat callers to consume them. Default N=5.

Expected speedup on the bound phases: ~5x. Total run target: ~8 min.

## Non-Goals

- ❌ No streaming responses (still wait-for-complete per call)
- ❌ No on-disk request cache (re-running the same audit re-spends tokens)
- ❌ No worker pool / subprocess parallelism — pure async fan-out
- ❌ No global queue across phases — each phase has its own pool
- ❌ No engine-level rate budget; rely on provider's 429 + our backoff

## Architecture

```
cli/src/agent/concurrency.ts        p-limit wrapper
cli/src/agent/llm-fetch.ts          consolidated OpenAI-compat fetcher

Consumers (refactored to share both):
  critic-client.ts
  test-spec-runner.ts
  test-emitter.ts
  test-case-generator.ts
```

`p-limit ^5.0.0` is added as a real dep (~3 KB, MIT, well-trodden).

## Module Contracts

**`agent/concurrency.ts`**

```typescript
export interface PoolOptions<T, R> {
  concurrency: number;          // >= 1, default 5
  items: T[];
  task: (item: T, idx: number) => Promise<R>;
  abort?: AbortSignal;
  logger?: TrackLogger;
}

export async function runPool<T, R>(opts: PoolOptions<T, R>): Promise<R[]>;
```

- Output order matches input order regardless of completion order.
- Per-task `try/catch`: a single failure does not abort siblings; the
  rejected promise's `reason` is surfaced as the corresponding output slot.
- `AbortSignal.aborted` short-circuits the pool: items not yet started
  resolve to `Promise.reject(new AbortError())` without invoking `task`.

**`agent/llm-fetch.ts`**

```typescript
export interface FetchLlmOptions {
  url: string;
  body: unknown;
  headers: Record<string, string>;
  maxRetries?: number;         // default 3
  baseDelayMs?: number;        // default 500
  capDelayMs?: number;         // default 8000
  abort?: AbortSignal;
  logger?: TrackLogger;
  sleep?: (ms: number) => Promise<void>;   // test seam
}

export async function fetchLlm(opts: FetchLlmOptions): Promise<{
  json: unknown;
  status: number;
  attempts: number;
}>;
```

- Retries on 429 + 5xx with `min(cap, base * 2^attempt) + jitter`.
- Honors `Retry-After` (seconds AND HTTP-date forms).
- Fast-fail on 4xx (non-429), `abort`, or `maxRetries` exhausted.

## Acceptance Checklist

1. `--concurrency N` threads through generator / runner / emitter.
2. Default concurrency = 5 when flag absent (was effective 1).
3. `runPool` order-preserving; `fetchLlm` honors `Retry-After`.
4. Not doing: streaming, caching, workers, global queue.
5. Done when 10×100ms tasks finish in ~430ms at N=3 (vs 1000ms serial),
   and `audit ./meme-weather-zerou-test` finishes under ~10 min.

## How To Verify

```bash
cd D:/lll/d2p/cli
npx vitest run src/agent/concurrency.test.ts src/agent/llm-fetch.test.ts

# Real run (requires MiniMax key):
time node cli/bin/zerou.mjs audit ./meme-weather-zerou-test \
  --concurrency 5 --config /tmp/zerou-minimax-cfg.json
```

## Implementation

- Worker dispatch: single sonnet worker (refactor touches 4 call sites; not
  parallelizable without merge conflicts).
- New files: `concurrency.ts` (+tests), `llm-fetch.ts` (+tests).
- Refactored: `critic-client.ts`, `test-spec-runner.ts`, `test-emitter.ts`,
  `test-case-generator.ts` (call-site consolidation only; public APIs
  unchanged).
- New tests: +22 (9 concurrency + 13 llm-fetch); all hermetic (mock fetch +
  sleep seams; no real network).
- Back-compat: legacy callers without `concurrency` get N=5; tests that
  need determinism pass `concurrency=1`.

## Status

```
Shipped: 31677dd
Tests: +22 cli (concurrency + llm-fetch); 0 regression
Dep: p-limit ^5.0.0 (one new dep, approved)
Dogfood: pending — perf smoke on tasks-not-real-LLM done; real-run e2e
         re-timed in subsequent phases on the same fixture
```
