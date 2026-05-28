# Phase 12 — React Review UI + `zerou review --serve`

> Replace the static HTML report with d2p's React + Tailwind Mission Control
> UI, served by a local HTTP server. Cream/orange aesthetic + real
> interactions (slide drawers, live filter, branch tree).

---

## Goal

After Phase 11.4 the dense HTML table covered "spreadsheet of changes",
but the React UI workstream in `ui/` had been sitting on the bench since
the d2p pivot. Phase 12 wires the two together:

```
zerou review --serve
  → local HTTP on 127.0.0.1:7777
  → serves ui/dist/* (built React bundle)
  → GET /api/review-data.json  ← ReviewBundle from .zerou/
  → GET /api/runs              ← list of archived runs
  → GET /api/runs/<ts>/review-data.json
  → GET /api/health
```

The static `enhance-report.html` from Phase 11 stays as a fallback (no
`--serve` flag); the React UI is the "I want to drill in" surface.

## Non-Goals

- ❌ No public-internet binding — 127.0.0.1 only, no auth, no TLS
- ❌ No SSE / live streaming yet (Phase 14 layer)
- ❌ No write endpoints — read-only HTTP server
- ❌ No new npm deps in CLI (pure `node:http`)
- ❌ No UI framework migration in `ui/` (stays Vite + React + Tailwind)
- ❌ No multi-project picker yet — `--serve` binds to one cwd at a time

## Architecture

```
cli/
  review-data-types.ts    ReviewBundle shape
  review-data.ts          buildReviewBundle: reads enhance-report.md +
                          test-results.json + branch-coverage.json +
                          audit-report.md → one JSON
  review-server.ts        node:http server, 127.0.0.1 only, path-traversal
                          protected, routes:
                            /                          ← ui/dist/index.html
                            /api/health
                            /api/review-data.json
                            /api/runs
                            /api/runs/<ts>/review-data.json
                            /assets/*                  ← ui/dist/assets/*
  review.ts               adds --serve [--port N] [--no-open]
                          locateUiDist: 5-candidate fallback

ui/
  types-zerou.ts          mirror of ReviewBundle for client consumption
  pages/ZerouReview.tsx   main page
  components/Zerou*.tsx   7 components (FindingsList, FilesList,
                          ModuleCards, BranchTree, LogEventDrawer,
                          StageScan/Test/Fix/Verify)
  mock/zerouBundle.ts     fixture for `?review=preview`
  App.tsx                 short-circuits on ?review=latest|preview|<ts>
                          before normal bootstrap
```

## Module Contracts

**`review-data.ts`**

```typescript
export interface ReviewBundle {
  meta: { project: string; runTs: string; durationMs: number };
  files: ChangedFile[];          // from enhance-report.md
  findings: ReviewFinding[];     // patched / rejected / skipped
  modules: ModuleResult[];       // Logging / BugFix / Health / Sentry / Env
  branchCoverage: BranchCoverageReport | null;
  testResults: TestCaseResult[];
  verify: VerifyResult;
  // Phase 12 leaves branchTraceEvents undefined; Phase 14 wires it.
}

export function buildReviewBundle(opts: { cwd: string }): Promise<ReviewBundle>;
export function writeReviewBundle(opts: { cwd: string; bundle: ReviewBundle }): Promise<void>;
```

- Pure aggregation; reads existing artifacts; writes
  `.zerou/review-bundle.json`.

**`review-server.ts`**

```typescript
export async function locateUiDist(): Promise<string | null>;
export async function startReviewServer(opts: {
  cwd: string;
  uiDistDir: string;
  host?: string;        // defaults to '127.0.0.1'
  port?: number;        // defaults to 7777
}): Promise<ReviewServerHandle>;
```

- Path traversal: every request path is `path.posix.normalize`'d, refused
  if it escapes `uiDistDir`.
- Port collision: if `port` is taken, the server logs the conflict and
  returns a non-zero exit (no auto-increment — predictable).
- Handle exposes `port`, `close()`, `address`.

**`review.ts`** (extended)

- `--serve` boots the server, calls `opener(http://127.0.0.1:<port>)`
  unless `--no-open`.
- Blocks until SIGINT (test seam `waitForExit` for unit tests).

## Acceptance Checklist

1. `zerou review --serve` boots a local HTTP server bound to 127.0.0.1.
2. `GET /api/review-data.json` returns a valid `ReviewBundle`.
3. UI renders findings / files / modules / branch tree against real data.
4. Not doing: SSE, write endpoints, public-net binding, multi-project picker.
5. Done when `meme-weather-zerou-test` smoke shows
   `http://127.0.0.1:7777` serving the UI with 12 files / 38 findings /
   72 fns / 15 self-deceiving.

## How To Verify

```bash
cd D:/lll/d2p
npm test --workspace cli -- review-data.test.ts review-server.test.ts review.test.ts
npm test --workspace ui

# Real smoke (meme-weather-zerou-test):
node cli/bin/zerou.mjs review ./meme-weather-zerou-test --serve --no-open &
curl -s http://127.0.0.1:7777/api/health         # {ok:true}
curl -s http://127.0.0.1:7777/api/review-data.json | jq '.files | length'
# → 12
```

## Implementation

- Worker dispatch: 3 parallel sonnet workers (per the commit message):
  - Worker A (cli/): `review-data-types.ts` + `review-data.ts` + 16 tests
  - Worker B (ui/): `types-zerou.ts` + `pages/ZerouReview.tsx` +
    7 Zerou* components + `mock/zerouBundle.ts` + 26 tests
  - Worker C (cli/): `review-server.ts` (~410 LOC) + 21+5 tests
- Lead integration: `enhance.ts` calls `buildReviewBundle` +
  `writeReviewBundle` after HTML write so `.zerou/review-bundle.json`
  refreshes per run.
- Bundle size: 499 KB JS (143 KB gz) + 40 KB CSS; 0 new npm deps in either
  workspace.

## Status

```
Shipped: 27f242e
Tests: cli 619 → 706 (+87); ui 100 → 126 (+26); 0 regression
Bundle: ui/dist 499 KB / 143 KB gz
Dogfood: meme-weather-zerou-test
  http://127.0.0.1:7777 → 12 files / 38 findings / 72 fns / 15 self-deceiving
```

## Follow-up (commit 604a008)

The Phase 14 worker B added `branchTraceEvents` to `types-zerou.ts` but
this phase's adapter was written before the field existed. Real projects
had `branchTraceEvents = undefined` while preview mode had mock data, so
the 追溯 (trace) section appeared empty on real data. Commit `604a008`
added `loadBranchTraceEvents()` to `review-data.ts` to read
`.zerou/branch-trace.jsonl`, drop hash + prev_hash (UI doesn't need them;
~50% smaller bundle), populate `bundle.branchTraceEvents`.
