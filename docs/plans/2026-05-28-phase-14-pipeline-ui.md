# Phase 14 — 5-Stage Pipeline UI + Tree-as-Log + SSE Live + Branch State Machine

> "Looks like a static report, not like ZeroU running" → rebuild the React
> review UI around the 扫→测→改→验→追溯 pipeline, side-by-side branch tree +
> log stream, SSE live streaming, branch state machine with heat-strip
> attention list.

---

## Goal

After Phase 12 the React UI worked but felt like a finished report. The
ZeroU 4-tier value (扫 / 测+修 / 验 / 追溯) wasn't legible in the layout;
nothing pulsed; the branch-trace existed but you couldn't watch it land.

Phase 14 ships in three sub-phases (all on `main`):

- **14 (commit `f881169`)** — 5-stage pipeline UI + tree-as-log + SSE
  backend (`/api/stream`, `/api/branch-trace`, `/api/logs/tail`).
- **14.5 (commit `3fe97c1`)** — Branch state machine + heat-strip overview
  bar.
- **14C (commit `9db0c81`)** — Live branch state stream from the audit
  pipeline (mechanical-red vs business-red distinction).
- **Polish (commit `67c65a3`)** — heat strip redesign: ranked file list
  replaces flat squares (so clicking a red square isn't a gamble).

Across all four, the user-visible promise: open `zerou review --serve`,
re-run `zerou audit` in another shell, watch the tree leaves snap from
gray → coral (evaluating) → green (covered) or rust (failed) **in real
time**, with worst-state bubbled to file + dir + heat-strip overview.

## Non-Goals

- ❌ No write endpoints (still read-only HTTP)
- ❌ No public-internet binding (127.0.0.1 only, same as Phase 12)
- ❌ No auth wall on SSE — local-only
- ❌ No WebSocket (SSE is sufficient; one-way push)
- ❌ No mobile-first / responsive redesign — desktop tab UX
- ❌ No undo / "rewind to seq" interaction (Last-Event-ID replay is the
  closest thing)

## Architecture

```
cli/src/review-server.ts        +574 LOC
  /api/stream             SSE, long-lived, fs.watch on .zerou/
                          events:
                            branch-trace.append  (one branch verdict landed)
                            log.append           (jsonl log line landed)
                            bundle.refresh       (audit/enhance finished)
                            heartbeat            (15s)
  /api/branch-trace       ndjson stream, ?since=<seq>
  /api/logs/tail          latest N=200 lines, ?track=<name>
  StreamHub class         32-conn cap, ring buffer for Last-Event-ID replay
                          50ms debounce for Windows multi-fire writes
                          recursive fs.watch on Win/macOS; manual fan-out on Linux

cli/src/agent/branch-trace-stream.ts   +582 LOC
  class BranchTraceStream {
    append(event)              // hash-chained sha256
    emitTransition(prev, next) // for in-progress state events
    close()
  }
  indexBranchesByLine(branches)
  findMatchingBranch(line, file, lookup)
                                       // POSIX-normalized, narrowest
                                       // containing range wins
  deriveStateFromVerdict(verdict, category)
                                       // pass            → covered
                                       // fail + auth     → business-red
                                       // fail + simple   → mechanical-red
                                       // inconclusive    → skip

ui/                              +1576 LOC (Worker B) +759 LOC (Worker C)
  pages/ZerouReview.tsx          rebuilt as 扫→测→改→验→追溯 pipeline cards
  components/
    ZerouStageCard.tsx           stage container
    ZerouStageScan.tsx           扫 — counts, file walk
    ZerouStageTest.tsx           测 — spec/result tables
    ZerouStageFix.tsx            修 — modules + diff
    ZerouStageVerify.tsx         验 — npm install/tsc/test/build chips
    ZerouStageTrace.tsx          追溯 — tree + log
    ZerouBranchTreeLog.tsx       side-by-side: project tree (L) + stream (R)
    ZerouLogEventDrawer.tsx      raw JSON + hash chain
    ZerouHeatStrip.tsx           (14.5) ranked file-attention list
  lib/branchState.ts             (14.5) state machine + classifier
  hooks/
    sseClient.ts                 EventSource wrapper, lastEventId via query
    useReviewStream.ts           React 18 strict-mode safe, exp backoff
                                 + jitter, maxRetries=6
```

## Branch state machine (Phase 14.5)

5 visible states + a transient `retrying`:

| State | Glyph | Color | Meaning |
|---|---|---|---|
| `pending` | ○ | gray | not yet evaluated |
| `evaluating` | ↻ | coral + spin | LLM-judge in flight |
| `covered` | ✓ | forest green | all signals lit |
| `mechanical-red` | ✗ 🔧 | rust + wrench | patcher could attempt |
| `business-red` | ✗ 🔒 | rust + lock | needs human review |
| `retrying` | ↻ | coral + retry-pulse + N/M counter | mid-retry |

Heuristic for unknown category biases toward `business-red` — conservative,
won't over-promise auto-fix capability.

Aggregation: dir / file / fn level pick the **worst** state of their
descendants. Heat strip surfaces files by attention rank (business-red
first, covered last).

## Module Contracts

**`review-server.ts` — `/api/stream`**

- Server-Sent Events; `Content-Type: text/event-stream`.
- Each `data:` payload is JSON; `event:` names: `branch-trace.append`,
  `log.append`, `bundle.refresh`, `heartbeat`.
- `Last-Event-ID` header → replay from that `seq` if still in the ring
  buffer; otherwise client gets a `replay-skipped` first event.
- Connection cap: 32. New conns past the cap get HTTP 503.

**`agent/branch-trace-stream.ts`**

```typescript
export class BranchTraceStream {
  constructor(opts: { cwd: string; runTs: string; logger: TrackLogger });
  async append(event: BranchTraceEvent): Promise<void>;
  async emitTransition(opts: {
    branchId: string;
    prev: BranchState;
    next: BranchState;
    reason?: string;
  }): Promise<void>;
  async close(): Promise<void>;
}
```

- Resumes hash chain from existing file tail (subsequent `audit` runs
  append, not overwrite).
- Concurrent serialization: one in-flight write at a time; subsequent
  `append`s queue.
- Error swallowing: a failing stream MUST NOT break the audit runner; the
  caller continues without it.

**`ui/hooks/useReviewStream.ts`**

```typescript
export function useReviewStream(): {
  status: 'idle' | 'connecting' | 'connected' | 'closed' | 'errored';
  connected: boolean;
  events: BranchTraceEvent[];          // ring-trimmed at maxEvents=500
  logEvents: LogEvent[];               // ring-trimmed
  totalReceived: number;
  retryCount: number;
  bundleStale: boolean;                // flips true on bundle.refresh
};
```

- Backoff: `min(30000, 500 * 2^retryCount) + jitter(0..250ms)`,
  `maxRetries=6`.
- `localhost` gate: hook refuses to connect to non-local hosts (defense in
  depth even though server already binds 127.0.0.1).

## Acceptance Checklist

1. `curl -N /api/stream` emits one heartbeat per 15s and `event:` names
   listed above.
2. UI's `?review=latest` renders the 5-stage pipeline.
3. Branch leaves transition pending → evaluating → covered/red as the
   audit runs.
4. Not doing: write endpoints, public-net binding, WS, undo.
5. Done when smoke shows `/api/stream` heartbeats AND
   `<branch leaf>[data-branch-state]` changes from `pending` to a terminal
   state without page reload during a live `zerou audit`.

## How To Verify

```bash
# Phase 14 backend smoke:
cd D:/lll/d2p
npm test --workspace cli -- review-server.test.ts \
                              agent/branch-trace-stream.test.ts
npm test --workspace ui

node cli/bin/zerou.mjs review ./meme-weather-zerou-test --serve --no-open &
curl -s http://127.0.0.1:7777/api/health
# → {ok:true, version: 0.2}
curl -N http://127.0.0.1:7777/api/stream | head -5
# → id: 1
# → event: heartbeat
# → data: {"ts": ...}

# In a second shell, kick the audit:
node cli/bin/zerou.mjs audit ./meme-weather-zerou-test \
  --config /tmp/zerou-minimax-cfg.json
# → browser shows tree leaves pulse coral then snap to terminal states
```

## Implementation

- Phase 14: 3 parallel sonnet workers (SSE backend / pipeline UI / stream
  hook) + lead integration.
- Phase 14.5: single sonnet worker — `lib/branchState.ts` + `ZerouHeatStrip`
  + integration into `ZerouBranchTreeLog`.
- Phase 14C: single sonnet worker — `agent/branch-trace-stream.ts` + audit
  + test-spec-runner wiring.
- Heat strip redesign (`67c65a3`): single fix — replaces flat-square
  bar with thin overview + ranked-attention list because clicking a flat
  red square felt like gambling.
- Cross-platform `fs.watch`: native recursive on Win/macOS; manual fan-out
  per dir on Linux (limitation of the platform's watch API). 50ms debounce
  for Win multi-fire writes.
- ZeroU rename: same commit (`f881169`) renamed remaining "d2p" mentions in
  `index.html` title, `ZerouReview '← d2p' link`, `Preview.tsx h1`,
  `PreviewIndex.tsx h1 + body copy`.

## Status

```
Shipped:  f881169 (14), 3fe97c1 (14.5), 9db0c81 (14C), 67c65a3 (heat redesign)
Tests:
  cli  700 → 717  (+17 from SSE backend + 1 coverage fix)
       717 → 734  (+17 from branch-trace-stream; ui 14.5 + 14C had no cli delta)
  ui   126 → 183  (+57 from Phase 14: B 21 + C 29 + sundry)
       183 → 218+ (+35 from 14.5: branchState 27, HeatStrip 8)
       218 → 227  (+9 from 14C + redesign sweeps)
  Final at time of writing: cli 734 pass / 1 fail (pre-existing) / 1 skip
                            ui  227 pass
Bundle:  ui/dist 528 KB / 151 KB gz (was 499/143 at Phase 12)
Dogfood: meme-weather-zerou-test live audit watched in browser; leaves
         pulse + snap as verdicts land.
```

## Open question for lead

The 14C commit message mentions "live branch state stream" wired into the
audit pipeline, but `audit.ts` continues to also write the canonical
`branch-trace.jsonl` at end-of-run. The live stream covers branches that
had specs; the end-of-run snapshot covers the full AST. These two writers
share the same `runTs` directory but emit overlapping events. Worth a
look in a follow-up: dedupe semantics, or document that the live stream is
a strict subset.
