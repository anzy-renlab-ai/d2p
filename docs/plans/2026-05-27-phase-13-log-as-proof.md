# Phase 13 — Log-as-Proof Workflow (branch-trace.jsonl + `zerou coverage`)

> ZeroU's log output should ITSELF be the proof that every branch was
> exercised. Not a UI screenshot, not a report — just a JSONL file you can
> `cat | jq | sort -u | wc -l`. Per `feedback_zerou_log_as_proof` memory
> and `docs/reviews/2026-05-27-log-as-proof-prior-art.md`.

---

## Goal

User insight in 2026-05-27:

> 我要你调研的不是有没有人做 0u，而是这种项目树的表现形式怎么体现到 log 上，
> 换句话说这个 log 的表现形式就可以为我们的产品证明效果。

Translated: ZeroU's log stream should be a self-contained completeness
proof. A third party should be able to clone your repo + the jsonl, never
look at any ZeroU UI, and conclude "every branch was exercised".

This forces the schema:

1. Each log line = one **wide event** (Honeycomb / OTel idiom).
2. Carries OpenTelemetry semantic fields: `trace_id`, `span_id`,
   `code.function`, `code.file.path`, `code.line.number`.
3. Carries `branch_id` (`file:fn@line:kind-direction#n`) so
   `jq -r 'select(.event=="branch.evidence") | .branch_id' *.jsonl | sort -u | wc -l`
   IS the coverage number.
4. Hash chain (`seq` + `prev_hash` + `hash`) — tamper-evident with no
   crypto deps beyond `node:crypto`.

Phase 13 has two slices:

- **13.1 — branch-trace.jsonl writer.** Wide-event emitter wired into the
  audit pipeline after branch-coverage is collected.
- **13.2 — `zerou coverage` command.** CLI that streams the jsonl, dedupes
  `branch_id`s, computes `coverage_pct`, exits 0/1 by `--threshold`.

Benchmark v1 was reviewed by a hostile reviewer and **deferred** — see
`project_zerou_benchmark_deferred` memory + `2026-05-27-zerou-benchmark-critique-v1.md`.
Phase 13 ships the schema; benchmark waits for multi-project data.

## Non-Goals

- ❌ No benchmark numbers shipped (deferred per critique)
- ❌ No proprietary log format — must be OTel-compatible
- ❌ No external storage / shipping (Twelve-Factor: stdout/file only)
- ❌ No public network — coverage command reads local files
- ❌ No mutation / fuzz coverage; only AST-branch coverage

## Architecture

```
cli/src/agent/branch-trace.ts
  writeBranchTrace(cwd, report):
    - emits one JSONL event per branch
    - event = 'branch.evidence'
    - shape (OTel-compatible):
        { trace_id, span_id, event,
          branch_id, code.function, code.file.path, code.line.number,
          signals, verdict, evidence,
          seq, prev_hash, hash }
    - SHA-256 hash chain (zero crypto deps; node:crypto only)
    - Deterministic: same BranchCoverageReport → byte-identical jsonl

cli/src/coverage.ts
  runCoverage:
    - streams branch-trace.jsonl line-by-line via readline
    - dedupes branch_id; counts unique seen
    - denominator = summary.branchesTotal from branch-coverage.json
    - flags: --threshold N → exit 0/1 gate
             --strict       → verdict='covered' only
             --json         → machine output
             --run <ts>     → archived run instead of latest
             --by-file / --by-function   → group output
             --verify-chain → re-walk hashes; non-zero on tamper
             --quiet        → suppress narrative
    - exit codes:
       0 ok / threshold met
       1 coverage < threshold
       2 invalid args / bad path
       4 missing required artifact
       5 hash chain broken
```

## Module Contracts

**`agent/branch-trace.ts`**

```typescript
export interface BranchTraceEvent {
  trace_id: string;
  span_id: string;
  event: 'branch.evidence';
  branch_id: string;
  'code.function': string;
  'code.file.path': string;
  'code.line.number': number;
  signals: Record<string, unknown>;
  verdict: BranchVerdict;
  evidence?: unknown;
  seq: number;
  prev_hash: string;
  hash: string;
  [k: string]: unknown;
}

export async function writeBranchTrace(opts: {
  cwd: string;
  report: BranchCoverageReport;
  runTs?: string;        // omits → "now" in YYYYMMDD-HHMMSS form
  logger: TrackLogger;
}): Promise<{ path: string; events: number }>;
```

- Persists to `.zerou/branch-trace.jsonl` AND
  `.zerou/runs/<ts>/branch-trace.jsonl`.
- Determinism: branches sorted by `(file, line, kind, direction, index)`;
  no per-run randomness in the hash inputs.
- `seq` starts at 1; `prev_hash` of event 1 = `"0".repeat(64)`.

**`coverage.ts`**

```typescript
export interface CoverageOpts {
  argv: string[];
  writeOut?: (s: string) => void;
  writeErr?: (s: string) => void;
}

export async function runCoverage(opts: CoverageOpts): Promise<number>;
```

- Streams `branch-trace.jsonl` via `readline`; never `readFileSync` the
  whole file (the 600 KB streaming test pins this).
- `--strict` mode: only verdict `'covered'` counts (all 4 signals lit).
- `--verify-chain`: recomputes hash chain; on mismatch returns exit 5 with
  `last_good_seq` in JSON output.

## Acceptance Checklist

1. `audit` writes `.zerou/branch-trace.jsonl` after branch-coverage.
2. `cat .zerou/branch-trace.jsonl | jq -r '.branch_id' | sort -u | wc -l`
   equals the AST branch count.
3. `zerou coverage --threshold 80` exits 1 when coverage < 80%.
4. Not doing: benchmark publishing, mutation coverage, shipping logs.
5. Done when `meme-weather-zerou-test` emits 359 branch.evidence events
   and `zerou coverage` reports the 75/359 = 20.9% number used in the
   commit message.

## How To Verify

```bash
cd D:/lll/d2p/cli
npx vitest run src/agent/branch-trace.test.ts src/coverage.test.ts

# Dogfood:
node cli/bin/zerou.mjs audit ./meme-weather-zerou-test \
  --config /tmp/zerou-minimax-cfg.json
wc -l ./meme-weather-zerou-test/.zerou/branch-trace.jsonl
# → 359
cat ./meme-weather-zerou-test/.zerou/branch-trace.jsonl \
  | jq -r '.branch_id' | sort -u | wc -l
# → 359
node cli/bin/zerou.mjs coverage ./meme-weather-zerou-test
# → Branches exercised: 75 / 359 (20.9%)
node cli/bin/zerou.mjs coverage ./meme-weather-zerou-test --threshold 80
# → exit 1
node cli/bin/zerou.mjs coverage ./meme-weather-zerou-test --verify-chain
# → exit 0 (chain intact)
```

## Implementation

- Worker dispatch: 2 sonnet workers (writer 13.1, CLI 13.2).
- New deps: none. `node:crypto.createHash('sha256')` only.
- `agent/branch-trace.ts`: 232 LOC + 17 tests.
- `coverage.ts`: 444 LOC + 22 tests (including 600 KB streaming + tamper
  detection + exit code matrix).
- Wires: `audit.ts` calls `writeBranchTrace` after `writeBranchCoverage`;
  `zerou-cli.ts` dispatches the new subcommand.

## Status

```
Shipped: 41ab59e (13.1 + 13.2 in one commit)
Tests: cli 706 → 717+ (+17 branch-trace + 22 coverage); 0 regression
Dogfood: meme-weather-zerou-test
  - branch-trace.jsonl: 359 events
  - jq | sort -u | wc -l: 359 (matches AST denominator)
  - zerou coverage: 75/359 = 20.9% (default mode, signals ∉ {untested,unknown})
```

## Boundary note: log-as-proof is domain B, not domain A

Per `project_zerou_two_domains_separated` memory: **branch-trace.jsonl is
domain B (the product runtime)**. ZeroU's own dev-process logs (`docs/`,
git, test output) are domain A. Phase 13 lives entirely in B — what users
see when they run `zerou audit` on their app.
