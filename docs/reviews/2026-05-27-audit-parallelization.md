# Audit Parallelization Plan — Phase 11

> Investigation only. No code changed. Evidence from the 2026-05-27 run on
> `meme-weather-zerou-test` (trace `01KSM5CGZZC9VAVXB43JNB14Q7`), wall time
> 39min 50s.

## TL;DR

The audit is 100% I/O-bound on serial LLM calls. Three phases — `test-gen`
(5min), `test-run` (8.7min), `emit` (24.7min) — each do a `for spec of …`
loop that awaits one MiniMax call per iteration. Static preset scans are
negligible. Recommended fix: wrap each per-spec loop in a `p-limit` pool
with N=5 (configurable via the **already-parsed-but-ignored** `--concurrency`
flag at `cli/src/audit.ts:89`). Expected speedup: ~5x for the LLM-bound
phases, total run drops to ~8min. Add 429 retry with jitter + cooperative
cancellation while we're in there.

## Empirical bottleneck breakdown

Numbers extracted from the JSONL log (events: `*.start` / `*.complete` ts deltas;
per-call durations from `agent.emit.spec.llm-call.success`):

| Phase | Iterations | Wall time | LLM-bound? | Notes |
|---|---|---|---|---|
| project-detection + checklist | a few | ~29s | yes | 2-3 LLM calls, low-impact |
| **test-gen** (`generateTestCases`) | 13 targets | **300.0s** (5.0min) | yes | ~23s per call (target → ≤3 specs) |
| **test-run** (`runTestCaseBatch`) | 33 specs | **519.2s** (8.7min) | yes | ~15.7s avg per call; **lots of 30s timeouts** |
| **emit** (`emitVitestTests`) | 36 specs × 12 files | **1481.0s** (24.7min) | yes | avg 16.1s, max 26.8s per call; sum of 36 success calls alone = 580.8s, rest is failures / retries / waits |
| presets + report writer | n/a | seconds | no | regex scans + file writes |

Cumulative LLM-call wall time **dominates total**. Total file says
1481+519+300 = **2300s ≈ 38.3min** of the 39.7min observed, i.e. 96.5% of
audit time is spent awaiting a single LLM HTTP response. CPU is idle.

Per-call cost (from 36 emit successes only):
- avg: 16.1s, min: 3.66s, max: 26.84s
- emit `total_s=580.8s` for successes — the rest of the 1481s emit window is
  failures + parse-fallback retries + DNS/keepalive. **There is no retry layer
  today**, so 30s timeouts (visible in `agent.test-run.case.llm-call.failure`)
  are pure dead time.

## Dependency graph

```
detectProject ─┐
               ├─→ buildChecklist ─→ generateTestCases ─→ runTestCaseBatch ─┐
project-walk ──┘            │                                              │
                            └─→ (specs)                                    │
                                   │                                       │
                                   └────────────→ emitVitestTests ←────────┘
                                                       │
                                                       └─→ runVitest (real exec, after emit)
```

**Independently parallelizable inside a phase**:
- `test-gen`: per-target LLM call (the loop at `test-case-generator.ts:747` —
  `for (const target of targets)`). Each target call is independent; output is
  collected into a flat array.
- `test-run`: per-spec LLM call (`test-spec-runner.ts:256` — `for (const spec of specs)`).
  Each spec reads only its own source window. Pure fan-out.
- `emit`: two-level — outer loop is per-target-file bucket
  (`test-emitter.ts:96`), inner loop per-spec inside bucket
  (`test-emitter.ts:107`). The **inner** spec calls are independent. The
  outer file write is sequential by design (one file per bucket), but writes
  are fast — the cost is the inner LLM calls.

**Strict ordering across phases**: gen → run, gen → emit. (Run and emit do
NOT depend on each other and could in theory run in parallel; but emit is
heavier and consumes `testResults` for downstream `runVitest`, so we keep
them sequenced — no extra complexity worth the ~9min saving once each is
parallel internally.)

## Recommended concurrency strategy

**Use `p-limit`** (≈1KB, 1 dep, zero runtime overhead, ubiquitous, MIT, ~70M
weekly downloads). Reasons:

- DIY semaphore (~30 LOC) is fine but `p-limit` is the de-facto standard and
  removes a bikeshed.
- `Promise.all` with fixed-batch chunking under-utilizes when calls have
  variable latency (3.6s vs 26.8s in our data — chunked batches stall on the
  slowest member, leaving 4 of 5 workers idle for ≥20s every batch).
- Async iterators are a bigger refactor for marginal benefit.

`p-limit` is a single-function wrapper that maintains a queue + active count
and resolves slots as promises settle — exactly the variable-latency case
we have.

**Per-phase caps (initial guess; tunable via `--concurrency` flag)**:

| Phase | Default N | Why |
|---|---|---|
| test-gen | 5 | Largest target windows; ~23s avg latency. 5 ≈ 75s/13 targets ≈ 3 batches |
| test-run | 5 | Plenty of headroom even on a 60 RPM key. 33 specs / 5 ≈ 7 windows × 16s ≈ 110s |
| emit | 5 | Identical profile to test-run. Was the worst phase, will be the biggest win |
| critic (existing preset critic-client) | 3 | Lower — critic verdicts are short, run during static phase; lower latency means smaller benefit, and we don't want to compete with the agent phases |

**Single global pool, not per-phase pools.** Phases run sequentially anyway,
so one shared `p-limit(N)` instance lets `--concurrency 5` mean "≤5 in
flight, ever". This is also what the `cmdOpts.concurrency` CLI flag at
`audit.ts:89` already promises but doesn't deliver.

**MiniMax rate limits**: the published default for paid keys is on the
order of **120 RPM** for `MiniMax-M2.7-highspeed` (varies by tier — the
provider does NOT publish a hard public table; treat as estimate). At
avg ~16s/call, 5 concurrent ≈ 18.75 RPM — comfortable headroom. We
should *not* push past N=8 without telemetry — that's where 429s start
showing up on most OpenAI-compat providers.

## Error handling under concurrency

Today: each spec failure is contained (`runTestCase` never throws,
`renderSpec` falls back to `it.todo`). Keep that — concurrency must not
change failure semantics.

Rule: **`Promise.allSettled`-style fan-out, never `Promise.all`**. One
spec's HTTP timeout must not poison the other 4 in-flight calls.

Within `p-limit`'s queue, `await limit(fn)` already isolates rejections per
call site. We wrap every per-spec call site in its own `try/catch` (mirroring
existing serial code) so the supervisor loop just collects results.

Partial-progress accounting: today log events are appended with the spec's
own `specId`. Under concurrency the only change is that events from
different specs **interleave in time order**, which is the natural ordering
of the JSONL log — no correctness loss. (See "Logging ordering" below.)

## Rate-limit + backoff strategy

Currently zero retry. Adding it has higher ROI than concurrency for the
**worst-case** tail: 3 of 33 test-run specs blew 30s timeouts (10% failure
rate); on a parallel run we'd want those to retry rather than land in
`inconclusive` permanently.

Proposal:

- Wrap the fetch call in `critic-client.ts`, `test-spec-runner.ts` (default
  caller), `test-emitter.ts` (default caller), `test-case-generator.ts`
  (default `defaultTestGenLlm`) — there are **four** duplicated default
  callers; collapse to a single helper module `cli/src/agent/llm-fetch.ts`.
- Retry on: HTTP 429, HTTP 5xx, network reset, timeout. **Not** on: HTTP
  4xx (other than 429), JSON parse errors, empty content.
- Backoff: exponential with full jitter: `delay = random(0, base * 2^attempt)`,
  base 500ms, max 3 attempts, cap 15s.
- Honor `Retry-After` header if present (MiniMax sometimes returns it on 429).
- Emit a new event `agent.llm-fetch.retry` with `{attempt, reason, delayMs}`
  so we can see retry hotspots in the JSONL.

This is independent of concurrency — applies to serial today, parallel
tomorrow. Recommend shipping it in the same PR.

## Cancellation semantics

Today: Ctrl-C kills the Node process; in-flight fetches finish in the
background until socket close. No bundle is written, partial logs may be
half-flushed.

Proposal:

- Create one `AbortController` per audit run in `doAudit()`.
- Thread its `signal` through `EngineConfig` (new optional field) → into
  every `fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) })`.
- On `SIGINT` / `SIGTERM`, call `controller.abort()`, drain `p-limit`'s
  queue (existing in-flight will reject with `AbortError`), flush loggers,
  exit code 130.
- Each per-spec error handler already treats abort same as "llm-call.failure"
  → it.todo / inconclusive fallback. No new code paths to design.

## Estimated speedup

Assuming N=5 concurrent + retry:

| Phase | Today | Proposed (N=5) | Speedup |
|---|---|---|---|
| test-gen | 300s | ~70s (13 targets / 5 ≈ 3 batches × 23s) | 4.3x |
| test-run | 519s | ~110s (33/5 ≈ 7 × 16s) | 4.7x |
| emit | 1481s | ~290s (36/5 ≈ 8 × 16s + retry overhead) | 5.1x |
| **TOTAL agent** | **~38min** | **~8min** | **~4.8x** |

Sanity-check vs the brief's estimate (N=5 ⇒ ~8min): match.

With N=3 (paranoid rate-limit cap): ~13min total — still a 3x win.
With N=10 (aggressive, may 429): theoretical ~5min, but tail effects from
retries probably keep it at ~6min.

## Risks

1. **MiniMax rate limit unknown.** No public hard number. Mitigation: start
   at N=5, expose `--concurrency`, log every 429, document the knob.
2. **Same model, different prompts in flight = same blind spot scaled up.**
   Concurrency doesn't fix the "same model self-confirms" issue Phase 9 Lite
   tried to mitigate; we just hit the same bad answers faster. Not a Phase 11
   problem to solve, but worth noting.
3. **Memory spike**: each in-flight prompt holds a context snippet (a few KB).
   N=5 × ~5KB × 3 phases concurrently impossible (phases are sequenced) ⇒
   <100KB extra RSS. Negligible.
4. **Log interleaving** confuses humans reading the JSONL in-order. Mitigation:
   the existing `trace_id` + `specId` fields already bind events; add a
   `--log-format=grouped` post-processor later if needed (out of scope for
   Phase 11).
5. **Vitest runner downstream** — `runVitest` is already an external process
   and unaffected by our concurrency layer.
6. **Tests for the runner** at `cli/src/agent/test-spec-runner.test.ts` (and
   peers) currently assume serial ordering of mock LLM responses. They must
   be reviewed and likely keep N=1 in tests via the `concurrency` option to
   stay deterministic.

## Implementation sketch (no code, just shape)

New module:
- `cli/src/agent/llm-fetch.ts` — shared `fetchChatCompletion({ baseUrl,
  apiKey, modelId, systemPrompt, userPrompt, timeoutMs, signal, logger })`
  helper. Built-in exponential-backoff-with-jitter retry on 429/5xx/abort.
  Returns `{ rawText, durationMs, attempts }`. Eliminates the four
  duplicated `defaultXxxLlmCaller` implementations.
- `cli/src/agent/concurrency.ts` — thin wrapper that creates a per-audit
  `p-limit` instance and exposes `runConcurrent(items, fn)` semantics with
  `Promise.allSettled` style result collection + per-item try/catch.

Files to edit (no new functions, just wrap existing loops):
- `cli/src/audit.ts` — read `cmdOpts.concurrency` (currently parsed at line
  89, **not used**); pass through to gen/run/emit as new optional
  `concurrency` field on their options.
- `cli/src/agent/test-case-generator.ts:747` — replace `for (const target of
  targets)` with `runConcurrent(targets, target => …)` using the same body.
  Add `concurrency?: number` to `TestGenOptions` (defaults to 1 to preserve
  current test semantics).
- `cli/src/agent/test-spec-runner.ts:246-260` — replace `runTestCaseBatch`'s
  serial loop. `TestBatchOptions.concurrency` already exists as a reserved
  field (`runTestCaseBatch.ts:58`), so this is a "fill in the stub" change.
- `cli/src/agent/test-emitter.ts:107` — wrap the inner per-spec loop in
  `runConcurrent`. Outer file-bucket loop stays serial (writes are cheap +
  trivially correct that way).
- `cli/src/critic-client.ts` — adopt `llm-fetch.ts` helper; no new
  concurrency at this layer (presets already loop serially per preset,
  acceptable for v1).

New dependency: `p-limit ^5` added to `cli/package.json` dependencies.

New events: `agent.llm-fetch.retry`, `agent.concurrency.batch.start /
.complete` (with `concurrency`, `total`, `succeeded`, `failed` counts).

Cancellation wiring: thread `AbortSignal` through `EngineConfig` or as an
extra arg on every default caller. Single SIGINT handler in `audit.ts`.

## Open questions

1. **Default concurrency** — keep the existing flag default (5)? Or pick a
   lower default (3) for safety and let power users opt-in to 5/8 via flag?
2. **Retry-After**: should we extend audit timeout when honoring it, or
   abort if the suggested delay exceeds remaining timeout budget?
3. **Telemetry**: should we add a `--cost-budget` per-run cap that the
   concurrency wrapper enforces (track tokens consumed across in-flight
   calls)? Out of Phase 11 brief; flag for Phase 12.
4. **Cross-engine fairness**: if the user configures multiple critic engines
   (one MiniMax, one DeepSeek), should the limiter be per-engine? Today the
   audit picks one critic for the whole run, so this is moot — note it for
   future.
5. **Should `runVitest` itself run with `--reporter=verbose` removed under
   parallel mode** to keep stdout sane? Probably not — vitest already
   parallelizes its own workers and our concurrency lives upstream.
