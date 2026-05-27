# ZeroU Benchmark Proposal v1 — Cross-Critique Bait

## The one number we measure

**Verified Branch Honesty (VBH)** — the fraction of AST-detectable branches in a project that are simultaneously **claimed** by an LLM-generated spec, **judged passing** by an LLM-judge with quoted evidence, **executed** by the test run (`c8` hit), **and** observed emitting an instrumented log line whose `branch_id` equals the AST branch id. One number, four-of-four agreement, expressed as a 0–100 score. The headline pitch: *VBH = 80 means 80% of the decisions your code can make have been provably exercised by an honest test.*

A small companion metric, **Self-Deception Rate (SDR)**, is reported alongside but never combined into VBH (orthogonality preserved). SDR is the fraction of branches where the judge said *pass* but the run+log evidence says *never executed*. SDR is the dishonesty floor — VBH is the honesty ceiling.

## Why ZeroU can measure this and no one else can

The metric requires **four artifacts produced in the same run on the same source tree** to be cross-referenced by a stable `branch_id`:

1. An **AST enumeration** of every decision point (Codecov has this, but throws it away after computing %).
2. An **LLM-generated spec** that names the target branch by intent ("`!email TRUE → 400`") — no coverage tool generates these; mutation testers (Stryker/PIT) generate *mutants*, not natural-language intents tied to branch arms.
3. An **LLM-judge verdict** with a verbatim source `evidence.snippet` whose line range falls inside the AST branch. SonarQube, Codecov, Diffblue, Sealights have zero LLM-judge layer.
4. A **runtime log emission** keyed by branch id, dropped by ZeroU's enhance Module B (the `logBranch(logger, 'fn.branch-id', { decision, ... })` calls injected into the worktree). No APM, no coverage tool, and no mutation tester emits a log line that says "I, branch `if-line9-true` of function `validateEmail`, just executed under spec `S-014`."

The two-of-four overlaps that exist elsewhere are weak:
- Codecov has (1)+(3): AST × run. It cannot tell you whether the test that hit the branch was *targeting* it or hit it by accident.
- Stryker has (1)+(3)+a-different-(2): AST × run × mutant survival. But mutants do not correspond to *human intents*; you cannot say "branch X was claimed by spec 'rejects negative input'".
- Datadog/Sentry have (3) only, sampled, and have no notion of (1)+(2)+(4).
- Diffblue has (1)+(2) of a sort, but no LLM-judge with evidence quoting, and no log-emit signal.

The *physical impossibility* claim is sharper: VBH = `|{branches : ast ∧ spec ∧ judge_pass(evidence∈range) ∧ run_hit ∧ log_emit(branch_id)}| / |{ast branches}|`. Computing it requires emitting (4) at runtime, which requires having generated (2) which requires having an LLM-judge for (3) which requires the AST enumeration (1). Other tools have fragments. Only ZeroU has the closed loop, because only ZeroU *writes the log line into the user's code* keyed by the AST id it itself produced.

That self-instrumented-then-self-judged-then-self-rerun loop is the moat.

## Formula

All inputs live in artifacts ZeroU already writes.

```
Inputs (from .zerou/ artifacts, one run):
  B    = set of AST branches from branch-coverage.json (root tree, flattened, depth ≤ maxBranchesPerFunction)
  S(b) = { spec ∈ test-results.json | spec.specMatches references b.id }
  J(b) = { spec ∈ S(b) | spec.status == 'pass' ∧
                          spec.evidence.snippet.lineRange ⊆ [b.lineStart, b.lineEnd] }
  R(b) = branch-coverage.json.functions[*].root...b.runtimeCoverage.branchHit == true
         AND linesCovered >= 1
  L(b) = ∃ log line in .zerou/logs/run-*.jsonl with
            { event: 'fn.<file>:<name>.<b.id>', decision: <any>, spec_id ∈ S(b).id }

Per-branch verdict:
  honest(b)  ⇔  S(b) ≠ ∅ ∧ J(b) ≠ ∅ ∧ R(b) ∧ L(b)
  deceit(b)  ⇔  J(b) ≠ ∅ ∧ ¬R(b)               (judge says pass, run did not fire)

Aggregates:
  VBH = 100 · |{ b ∈ B : honest(b) }| / |B|
  SDR = 100 · |{ b ∈ B : deceit(b) }| / |B|

Tie-breakers:
  - if |B| == 0 → VBH undefined (report N/A, never 100)
  - branch with kind='entry' counts as one branch (function-was-called)
  - megafunctions (>maxBranchesPerFunction) contribute their first N branches
    AND a penalty term: each truncated branch counts as ¬honest
```

The score is integer-rounded after computation. There are no weights to tune — the four signals are an **AND**, deliberately. The user vetoed weighted blends; conjunction is the inverse: any one of the four falling silent drops the branch from the numerator. This makes the number unforgiving but un-gameable in the obvious way.

Reproduction:

```bash
zerou audit <project> && zerou enhance <project>
node cli/dist/bin/zerou.js bench --emit-vbh < .zerou/branch-coverage.json
# stdout: { vbh: 73, sdr: 4, branches: 412, honest: 301, deceit: 17 }
```

Determinism note: AST enumeration is deterministic. Spec-matches and judge-evidence are stored verbatim in `test-results.json` after a run; the rerun executes the same recorded specs (no re-prompt of the LLM during scoring), so VBH is a function over the artifact, not over the LLM. Two scorers on the same `.zerou/` directory get byte-identical numbers (`jq -S` testable).

## Worked example

**Project: `meme-weather-data`** — a small Next.js app: 14 exported functions, 1 API route (`POST /api/forecast`), 1 fetcher, 1 zod validator.

After `zerou audit && zerou enhance`:

- `branch-coverage.json.summary.branchesTotal` = **86**
- AST detected: 14 entry-branches + 38 if/else arms + 11 ternary arms + 6 try/catch arms + 17 short-circuits = 86 ✓
- Specs generated: 41 (judge-pass: 33, judge-fail: 8)
- For each spec, `specMatches[].matchedTokens` joins to a branch id by overlap of label tokens (`'401' ∈ b.label` etc.). Joined: 47 of 86 branches have ≥1 spec.
- Judge-pass-with-evidence-in-range: 39 of those 47.
- Runtime hit (c8): of the 39, 35 have `branchHit=true`.
- Log emit by branch id (Module B's injected `logBranch` lines, grepped from `.zerou/logs/agent-*.jsonl`): of the 35, **31** emitted a log line whose `event` matches `fn.<file>:<name>.<branch.id>`.

```
VBH = 100 · 31 / 86 = 36   (a brutal, accurate first-pass score)
SDR = 100 · 4 / 86  =  5   (4 branches: judge said pass, c8 says no hit)
```

The 4 SDR branches are the precise "self-deceiving tests" the `judge-only` verdict in `BranchVerdict` already enumerates. The report links each by `file:line`.

Concrete user meaning at 36:
- Out of 86 decisions your code can make, only 31 have **all four** of: someone wrote a spec for it, the LLM said the spec passed and quoted *inside the branch*, the test actually executed the lines, and the runtime logger fired with the branch id.
- The other 55 are either un-spec'd (35), spec'd but the judge skipped the branch's lines (8), spec'd-and-judged-pass but the c8 never hit (4 — the SDR), or hit-but-never-emitted-a-log (8).

Score 36 → "your test suite is touching less than half your decision space honestly." Score 80 → "four out of five decisions in your app are demonstrably exercised end-to-end." Score 100 → "every if, every ternary, every catch is provably wired to a named human-intent spec and emits a traceable log."

## The benchmark suite

Five projects span an axis of **branch density × external-dependency surface × LLM-failure-mode**:

| # | Project | Lang/Stack | Why on the axis |
|---|---|---|---|
| 1 | **meme-weather-data** (the demo we already use) | Next.js + zod + fetch | Baseline: light branch density, one external API, well-typed. Anchor for "small honest app". |
| 2 | **express-todo-jwt** (canonical CRUD with auth) | Express + JWT + Postgres | Auth-aware fixture injection (Phase 11.3) is mandatory; checks ZeroU can score auth paths without leaking secrets. Exercises Module B log injection across middleware. |
| 3 | **nest-payments-state-machine** (a deliberately branchy domain) | NestJS + state machine on Order { pending → paid → refunded } | High branch-arm-count per function (12+ branches in the reducer). Stress-tests the megafunction penalty term and the spec-to-branch token join. |
| 4 | **fastify-stripe-webhook-handler** (event-driven with try/catch chains) | Fastify + Stripe SDK | Try/catch/finally arms dominate. Tests whether LLM-judge evidence falls into the catch arm specifically (a hard case — judges often quote the try). The exact place SDR spikes if the judge is sloppy. |
| 5 | **react-form-with-conditional-render** (UI ternaries) | React 19 + RHF + zod | Ternary-heavy, no server. Tests ZeroU on render-decision branches where "runtime hit" requires DOM-mount specs, not API specs. Probes whether VBH is meaningful on UI-only code. |

Selection rationale, in one sentence: each project hits one branch-kind that is the **dominant** kind of failure in real LLM-generated tests — entry (1), authed-conditional (2), state-machine cascade (3), try/catch-where-judge-mis-quotes (4), and ternary-render-without-runtime (5). A scorer that does well on all five has demonstrated robustness across the lattice.

Expected VBH on first ZeroU pass (calibration anchor, not target):
- (1) 60–75 — small surface, easy specs
- (2) 35–55 — auth fixtures pull it down
- (3) 25–45 — branch-fanout pulls the denominator
- (4) 30–50 — catch-arm evidence is the hardest sub-signal
- (5) 20–40 — UI ternaries get poor c8 unless DOM tests are first-class

If a third-party tool claims to also score these projects on VBH, it must produce the same `branch-coverage.json` schema and a log-emit file. Inability to do so = inability to compete on the metric.

## Threats to validity (preemptive)

1. **"Spec-to-branch token-match is heuristic — an LLM could write a spec named '`!email TRUE → 400`' that matches by string but tests the wrong thing."**
   Defense: matchedTokens are only one of four signals. Even if S(b) is gamed, J(b) requires the judge's `evidence.snippet` lineRange to fall inside `[b.lineStart, b.lineEnd]`. Gaming both requires LLM-output collusion across two independently-prompted engines (generator + judge). And R(b) + L(b) are independent of LLM output entirely — they are c8 + log file. To game VBH you must lie in two independent LLM passes AND make c8 and the log file lie.

2. **"Megafunctions get truncated and counted as ¬honest — that punishes legacy code unfairly."**
   Defense: that's intentional. ZeroU's claim is "decisions provably exercised". A function with 80 branches that ZeroU only enumerates the first 50 of is honestly *not* fully exercised by ZeroU. The penalty is calibrated and disclosed; users can raise `maxBranchesPerFunction` and rerun.

3. **"Log emit can be faked — a developer can sprinkle `logBranch(...)` calls without real tests."**
   Defense: VBH requires `spec_id ∈ S(b).id` in the log line's payload. The injected logger emits with the *current spec under test*; outside test runs the field is absent and the line doesn't count. Fakery requires forging both the test runner's spec stack and the log payload. Doable, but it's the same level of dishonesty as forging coverage to look at Codecov — both break honest CI on the next PR.

4. **"LLM-judge non-determinism — rerun gives a different VBH."**
   Defense: VBH is computed *over the persisted `test-results.json` + log files*, not by re-invoking the judge. Re-scoring the same artifacts is deterministic. A fresh `zerou audit && zerou enhance` may produce different numbers; that's a different test of the *system*, not the scoring formula. We will publish run-to-run variance on the suite (n=10 reruns per project) as a separate "Stability Index".

5. **"This is just 4-signal AND wrapped in a percentage — what's so special?"**
   Defense: The conjunction is the point. Every prior tool reports an OR or a weighted sum (Codecov OR, SonarQube weighted, mutation testers OR over mutant-state). ZeroU is the first to claim "all four signals must agree on the same branch id," and the first to have all four signals in one toolchain. The lattice was vetted by the user explicitly forbidding weighted blends.

## What would invalidate this benchmark

Honesty test — we retract VBH if any of the following turn out true after suite execution:

1. **Two independent reruns of `zerou audit && zerou enhance` on an unchanged source tree produce VBH numbers that differ by more than 5 points on three or more of the five suite projects.** (Threshold for "Stability Index" failure.) That would mean the scoring is dominated by LLM noise, not code structure.

2. **A trivial mutation — flipping a single `if` branch's body to throw — does not move VBH by at least 1/|B| in absolute terms** on at least four of five suite projects. That would mean the metric is insensitive to real code change.

3. **A third-party engineer who has never seen ZeroU source can, given only the public formula + the four input file shapes, reproduce the same VBH on a published `.zerou/` directory to within ±1 point.** If they cannot, the formula is not reproducible. If they can game it by hand-editing one of the four files in <30 minutes without breaking honest CI, the metric is not robust. Either failure → retract.

## Estimated implementation effort

- `cli/src/bench/vbh.ts` — pure function over the four artifacts, ~200 LOC. **6h.**
- `cli/src/bench/log-join.ts` — read `.zerou/logs/*.jsonl`, group by `(fn, branch_id, spec_id)`, ~150 LOC. **4h.**
- Wire into `enhance` to emit `.zerou/bench.json` alongside the report. **2h.**
- `zerou bench` CLI subcommand, JSON + human output. **3h.**
- HTML report panel — VBH hero number + SDR sub-line + click-into the 4-signal tree we already render. **4h.**
- Benchmark-suite repo with the five projects + scripted runner + expected VBH range. **12h.**
- Stability Index harness (n=10 reruns, variance report). **4h.**
- Spec-split docs (dev-doc + public-surface + independent test-doc per CLAUDE.md §2.5). **4h.**

**Total: ~39 engineering hours (≈1 worker-week).** No new dependencies; all inputs are existing ZeroU artifacts. The CLI surface (`zerou bench`) is the only new user-facing entry point and ships with its own jsdom + vitest tests in the same commit per the surface_without_self_test rule.
