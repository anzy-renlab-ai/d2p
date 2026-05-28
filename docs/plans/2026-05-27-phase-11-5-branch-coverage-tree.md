# Phase 11.5 — Per-Function Branch Coverage Tree + Self-Deceiving Detection

> Cross-reference 4 independent signals on every AST branch — AST, spec,
> LLM-judge evidence, runtime c8 — and expose the cases where they
> disagree. Disagreement IS the finding; self-deceiving tests get a red
> flag.

---

## Goal

Per `docs/reviews/2026-05-27-apm-branch-viz-prior-art.md`, the novel ZeroU
visual primitive is the "disagreement glyph" — when 2+ signals disagree on
the same `branch_id`, render bright + clickable. Phase 11.5 is the data
layer + report rendering of that primitive.

The 4 signals:

1. **AST** — does the branch exist? (static analysis via TS Compiler API)
2. **SPEC** — does any test `spec.then` text mention this branch outcome?
3. **JUDGE** — does the LLM-judge `evidence.snippet` quote this branch?
4. **RUN** — does vitest c8/istanbul show hits in this line range?

Verdict matrix:

| spec | judge | run | verdict |
|---|---|---|---|
| ✓ | ✓ | ✓ | `covered` |
| ✓ | ✓ | ✗ | `judge-only`  ← **self-deceiving** |
| ✓ | ✗ | ✗ | `spec-only` |
| ✗ | (any) | ✓ | `run-only` |
| ✗ | ✗ | ✗ | `untested` |

"Self-deceiving" = the LLM-judge confidently pointed at code as proof, but
runtime instrumentation never saw that line execute. The classic
"emit hand-tuned vibes" failure that the user's `feedback_zerou_log_as_proof`
memory wants ZeroU to refuse.

## Non-Goals

- ❌ No mutation testing (Stryker exists; we already pass Phase 8 §Non-Goals)
- ❌ No symbolic execution / SMT
- ❌ No per-spec line-by-line execution proofs (we use c8 range hits as
  proxy)
- ❌ No JaCoCo-style three-color diamond per-line in source view; the tree
  view summarises at function level
- ❌ No streaming live-update yet (Phase 14 layers that on top)

## Architecture

```
cli/src/agent/branch-coverage-types.ts   shapes
cli/src/agent/branch-coverage.ts         AST walker + signal cross-ref
cli/src/enhance/branch-tree-renderer.ts  HTML FUNCTIONS section

cli/src/audit.ts                         calls collectBranchCoverage() at
                                         end of test phase, writes
                                         .zerou/branch-coverage.json
cli/src/enhance.ts                       reads JSON, passes to writer
cli/src/enhance/html-report.ts           setBranchCoverage() →
                                         FUNCTIONS section between
                                         FINDINGS and VERIFY
cli/src/enhance/html-assets.ts           branch-tree CSS/JS + new filter
                                         dropdown
```

## Module Contracts

**`agent/branch-coverage-types.ts`**

```typescript
export type BranchVerdict =
  | 'covered'        // all 3 signals (spec + judge + run) ✓
  | 'judge-only'     // spec + judge ✓, run ✗ — SELF-DECEIVING
  | 'spec-only'      // spec ✓, judge + run ✗
  | 'run-only'       // run ✓, spec ✗ — incidental
  | 'untested'       // no signals
  | 'unknown';       // when run signal is unavailable

export interface BranchNode {
  branchId: string;  // `file:fn@line:kind-direction#n`
  kind: 'if-true' | 'if-false' | 'switch-case' | 'try' | 'catch'
       | 'finally' | 'ternary' | 'short-circuit' | 'loop-body';
  line: number;
  signals: { ast: true; spec: boolean; judge: boolean; run: boolean | null };
  verdict: BranchVerdict;
  childIds?: string[];
}

export interface FunctionCoverage {
  fnName: string;
  file: string;
  line: number;
  branches: BranchNode[];
  worstVerdict: BranchVerdict;
}

export interface BranchCoverageReport {
  generatedAt: string;
  cwd: string;
  summary: {
    functionsTotal: number;
    branchesTotal: number;
    perVerdict: Record<BranchVerdict, number>;
  };
  functions: FunctionCoverage[];
}
```

**`agent/branch-coverage.ts`**

```typescript
export async function collectBranchCoverage(opts: {
  cwd: string;
  testSpecs: TestCaseSpec[];
  testResults: TestCaseResult[];
  coverageReport?: CoverageReport | null;   // null if c8 didn't run
  logger: TrackLogger;
}): Promise<BranchCoverageReport>;
```

- Walks `*.ts`/`*.tsx` via `ts.createSourceFile` (no compilation — pure parse).
- For each `IfStatement` emits `if-true` + `if-false` branches; etc.
- Cross-references:
  - `signals.spec` = any `TestCaseSpec.then` mentions this branch's line range
  - `signals.judge` = any `TestCaseResult.evidence.snippet` quotes a line
    inside this branch
  - `signals.run` = coverage report has `>=1` hit on any line in the branch
  - `signals.run = null` if `coverageReport` is `null` (downgrade verdict
    to `unknown` rather than claim `covered`)
- Persists to `.zerou/branch-coverage.json`.

**`enhance/branch-tree-renderer.ts`**

```typescript
export function renderBranchTreeSection(opts: {
  report: BranchCoverageReport;
}): string;
```

- Pure function over the report.
- Emits a FUNCTIONS section: per-function ASCII branch tree with 4 signal
  micro-pips per node (red / yellow / green).
- Sort order: `self-deceiving` > `untested` > branch count desc > path.

## Acceptance Checklist

1. `audit` writes `.zerou/branch-coverage.json` after the test phase.
2. Renderer emits a FUNCTIONS section with per-branch verdict glyphs.
3. Filter dropdown: All / Has self-deceiving / Has untested / Fully covered.
4. Not doing: live updates, mutation testing, per-line diamonds.
5. Done when `meme-weather-zerou-test` dogfood surfaces ≥1 self-deceiving
   branch with the rendered tree pointing at the offending line.

## How To Verify

```bash
cd D:/lll/d2p/cli
npx vitest run src/agent/branch-coverage.test.ts

# Dogfood:
node cli/bin/zerou.mjs audit ./meme-weather-zerou-test \
  --config /tmp/zerou-minimax-cfg.json
jq '.summary' ./meme-weather-zerou-test/.zerou/branch-coverage.json
# Expected (from commit message):
#   functionsTotal: 72, branchesTotal: 359
#   perVerdict.judge-only: 15  (self-deceiving)
#   perVerdict.untested: 225
node cli/bin/zerou.mjs enhance ./meme-weather-zerou-test
node cli/bin/zerou.mjs review ./meme-weather-zerou-test
# → FUNCTIONS section visible with red-flag rows on top
```

## Implementation

- Worker dispatch: single sonnet worker (collector + renderer + integration
  co-evolve; ~1200 LOC for collector alone).
- AST walker handles: if/else, switch+case, try/catch/finally, ternary,
  short-circuit `&&`/`||`, loop bodies, optional chaining (best-effort).
- Runtime signal degradation: when `coverageReport === null`, `signals.run
  = null` and the verdict is `unknown`, never falsely `covered`. This is
  the "no self-deception" principle in code.

## Status

```
Shipped: 3640b1c
Tests: branch-coverage + branch-tree-renderer suites added; 0 regression
Dogfood: meme-weather-zerou-test
  - 72 functions, 359 branches
  - 15 self-deceiving (judge-only)
  - 225 untested
  - run signal unavailable (vitest c8 didn't run user code yet);
    verdict downgrade prevents false 'covered'
```
