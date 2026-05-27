# APM / Coverage Visualization Prior Art — for ZeroU Branch Tree

> Survey of mature observability, profiling, and coverage tools to inform
> ZeroU's per-function branch tree (AST × spec × LLM-judge × runtime). Goal:
> steal the strongest visual idioms; avoid the documented anti-patterns.

## TL;DR — 3 patterns we should borrow + 1 we should invent

**Borrow:**

1. **JaCoCo's three-color diamond + line background** (red / yellow / green) on
   the branch node. Compact, scan-friendly, 30 years of muscle memory in QA. We
   have 4 signals instead of 1, so use 4 micro-pips (one per signal) on each
   branch node rather than a single diamond — but keep red/yellow/green
   semantics intact.
2. **Speedscope's "Sandwich" view** for any selected branch — show callers
   above, callees below, both as mini-flame graphs. Solves the "where does this
   branch live in the larger story" problem without forcing the user to scroll
   a 4000-px tree.
3. **Honeycomb BubbleUp + Sentry "Issues"** model for the findings panel.
   ZeroU's findings ARE outliers in a 4-signal lattice; bubbling up "branches
   where signals disagree" is the same primitive as BubbleUp's "what's
   different about the slow requests".

**Invent (no prior art matches):**

4. **Signal-disagreement heatmap on the AST tree.** Coverage tools show one
   axis (executed Y/N). APM tools show one axis (latency). ZeroU is the first
   to overlay *four orthogonal verdicts* on the same AST node. The novel
   primitive is the **disagreement glyph**: when AST + runtime + spec +
   judge agree, render in muted neutral; when any two disagree, render
   bright + clickable. Disagreement IS the finding — it's the only place the
   user needs to look.

## 1. Survey of dominant visual primitives

| Tool | Primitive | Strength | Weakness for ZeroU |
|---|---|---|---|
| Datadog APM / Profiler | Flame graph + Call graph + Timeline | Top-down call hierarchy; "Code Hotspots" tab links span → flame frame | No notion of "branch not reached" — sampling-based, only shows what ran |
| Dynatrace PurePath | Per-request execution tree (table) with elapsed / self / duration columns | Adaptive detail — slower paths get more sampling | Tree explodes on deep stacks; per-request, not aggregated by branch |
| New Relic CodeStream | Inline CodeLens above each method in the IDE | Latency + error rate sits *on* the source code, zero context switch | Only method-level, no branch granularity |
| Sentry Profiling | Aggregate flame graph + waterfall + differential flame graph | Differential view (before vs after) — closest to a "fix verifier" view | Profile-only; flame frames not tied to AST branches |
| Honeycomb | Heatmap + BubbleUp + waterfall | BubbleUp surfaces what's *different* about outliers automatically | Trace-based, not code-shape based |
| Codecov | PR comment + GitHub gutter checks (hit / partial / miss) | Inline + 3-state ("partial" = branch missed) lives where review happens | Coarse — line-level, not branch-arm-level; no "why" annotation |
| Istanbul / nyc HTML | Source view with yellow ("E"/"I") flags for branches | Per-branch annotation: "if path not taken" / "else path not taken" | Wall of yellow if coverage is bad; no aggregation |
| JaCoCo | Diamond glyphs (red / yellow / green) per line + line bg color | Single icon communicates 3 states; trained QA eye recognises instantly | Java-coupled; no drill-down beyond line |
| SonarQube | Coverage gutter + "conditions covered / total" per line | Two-dim metric (lines × conditions) visible side by side | Static dashboard; doesn't connect to live runs |
| pprof | Flame graph + call graph + tree (table) | Multiple views over same data; zoom-to-subtree | Built for CPU time, not coverage; missing-branch = invisible |
| Speedscope | Time-order flame chart + left-heavy + Sandwich view | Sandwich = caller + callee context for one frame — perfect for "this branch's story" | Profile-only; no static analysis |
| Chrome DevTools | Flame chart + Bottom-Up + Call Tree tabs | Three tabs over same data; "Self Time" vs "Total Time" axis split | UI-perf-focused; no branch awareness |
| Stryker / PIT | Per-mutant status (killed / survived / no-coverage) overlaid on source | Single-line color encodes test *quality*, not just coverage | Mutant-flat list with no AST tree; doesn't aggregate up |
| Diffblue Cover | "Cover Reports" dashboard — coverage levels + testability + risk | Aggregates "risk" + "testability" as separate axes (precedent for multi-signal) | Closed-source UI; little detail public on visual idiom |
| Sealights | Test Gaps Analysis per user story + Quality Gates | Maps coverage to *what changed* (delta-aware) | Dashboard-heavy; per-branch detail buried |

The pattern: **flame graph** wins for *runtime-sampled* data, **gutter
annotation** wins for *static coverage*, and **dashboard + drill-down** wins
for *aggregated risk*. ZeroU sits across all three — it's the only tool that
fuses AST shape + runtime + LLM judgements. The 4-signal lattice doesn't map
to any single existing primitive.

## 2. The "branch never reached" empty state

This is where most tools fail, and where ZeroU has a real opportunity.

| Tool | Empty-state treatment |
|---|---|
| Datadog Profiler | **Invisible.** Sampling-based — branches that never ran simply don't appear in the flame graph. Catastrophic blind spot for our use case. |
| Sentry Profiling | Same — profile-only. Differential flame graph shows new frames in red but cannot show "missing" frames. |
| Dynatrace PurePath | Same — only captured executions render. Unsampled paths invisible. |
| Istanbul / nyc | **"E" / "I" flag in the gutter** — explicit "else path not taken" / "if path not taken" badge on the line. Closest precedent. |
| JaCoCo | **Red diamond + red line background** for uncovered branches. Strongest visual signal in any mature tool. |
| Codecov | "**Partial**" status (hit / partial / miss tri-state) — surfaces "some branches missed" as a first-class state. |
| SonarQube | "Conditions covered: 2 of 4" annotation per line — exposes the ratio explicitly. |
| Stryker / PIT | "**No coverage**" mutant state — gray, distinct from killed (green) and survived (red). |
| Sealights | Test Gap report lists "new code not yet tested" as a named first-class artifact. |

Takeaway: **runtime-only tools cannot do this**. The static-coverage family
(JaCoCo / Istanbul / Codecov) all use red / yellow / gray as the universal
language. ZeroU should adopt the same palette so the visual contract is
already familiar to QA engineers — but extend it: a branch that AST-exists but
has no runtime hit AND no judge-pass AND no spec-claim is a *quadruple miss*,
and should look louder than a JaCoCo red. Use a saturated red border + dashed
inside (the dashing communicates "literally nothing reached here") to
distinguish from "ran but failed".

## 3. Best-in-class examples (reference URLs)

- **Datadog flame graph + Code Hotspots tab integration**:
  https://docs.datadoghq.com/profiler/profile_visualizations/ — flame graph
  with span correlation. The "click flame frame → jump to trace span" is the
  drill-down idiom worth copying.
- **Datadog timeline view** (a flame graph laid out in chronological time):
  https://www.datadoghq.com/blog/continuous-profiler-timeline-view/ — useful
  for showing "when in the test run did this branch fire".
- **Sentry Differential Flame Graph**:
  https://docs.sentry.io/product/explore/profiling/differential-flamegraphs/ —
  before/after profile diff, with new frames colored. Direct precedent for
  ZeroU's "before fix vs after fix" verification view.
- **Honeycomb BubbleUp**:
  https://www.honeycomb.io/platform/bubbleup — outlier detection that
  highlights *what's different* about a selected region. Same pattern we want
  for "what's different about disagreement branches".
- **Codecov line-by-line GitHub Checks**:
  https://about.codecov.io/blog/announcing-line-by-line-coverage-via-github-checks/
  — gutter annotation inside the PR review surface. Lives where the developer
  already is.
- **JaCoCo counters / diamond legend**:
  https://www.eclemma.org/jacoco/trunk/doc/counters.html — the canonical
  red/yellow/green branch diamond.
- **Speedscope sandwich view**:
  https://www.speedscope.app/ + https://jamie-wong.com/post/speedscope/ —
  caller-frame + callee-frame split. Adopt verbatim.
- **PIT mutation report colors**:
  https://pitest.org/ — light/dark green/pink as a 4-state encoding (more
  expressive than JaCoCo's 3-state, similar to what ZeroU needs).

## 4. Code-coverage angle (Codecov / Istanbul / JaCoCo)

These three define the QA visual vocabulary engineers already know:

- **Codecov**: tri-state ("hit", "partial", "miss") inline in PR. UX win is
  *location* — it's in the PR review, not a separate dashboard. ZeroU's
  findings panel should integrate the same way with whatever review surface
  the user uses (cli? web? IDE?). Codecov also has a comparison view
  (PR diff coverage delta) — the "this PR improved coverage by 2.3%" comment
  is the canonical *before-vs-after* primitive for static coverage.
- **Istanbul / nyc HTML**: per-file source rendered with line-level coloring
  and per-branch "E" (else not taken) / "I" (if not taken) badges. The badge
  matters — it tells you *which arm* of the branch is uncovered, not just
  that the line is partial. ZeroU's 4-signal lattice has the same need: which
  *signal* is missing on each branch must be visible at a glance, not require
  a hover.
- **JaCoCo**: diamond + bg color. The diamond is the most compact tri-state
  glyph in the wild. ZeroU could adapt this into a **4-pip indicator** — a
  2×2 micro-grid on each branch node, one cell per signal (AST / runtime /
  spec / judge). Each cell colors red/yellow/green/gray. From 6 feet away you
  see "this branch has a red corner" → know to drill in.
- **SonarQube**: shows "2 of 4 conditions covered" inline. Useful for
  *quantified ambiguity* — when partial, how partial. ZeroU should adopt the
  fraction format for the aggregate signal at the function root: "3/12
  branches in this function pass all 4 signals".

## 5. AI test-gen cousins (Diffblue, Sealights, Mutmut / Stryker / PIT)

This is the closest territory to ZeroU.

- **Diffblue Cover Reports** layer multiple analytics axes — coverage,
  testability, risk — on the same codebase. They don't publish the visual
  detail, but the *multi-axis* framing is precedent: "coverage" alone is no
  longer enough; you need multiple lenses on the same artifact. This is
  exactly the 4-signal motivation in ZeroU.
- **Sealights "Test Gap Analysis"** is *delta-aware*: it answers "in *this
  release*, what new code is untested?" rather than "in *all of history*,
  what's uncovered?" — the diff-coverage framing should apply to ZeroU too.
  When a worker fixes a finding, show the user "branches that flipped from
  red to green in this fix", not the full tree again.
- **Stryker / PIT** are the most advanced precedent. Per-mutant state
  (killed / survived / no-coverage / timeout / error) is a richer encoding
  than coverage's binary. PIT's HTML report colors lines by *mutation
  coverage* (dark green) vs mere *line coverage* (light green) — this two-axis
  on a single line is the closest existing precedent for ZeroU's multi-signal
  cell. The interactive HTML drill-down (click a surviving mutant → see the
  exact code change + which tests passed it) is the *finding* UX ZeroU
  should match.

## 6. Recommendation for ZeroU

### Visual primitive — hybrid tree, not flame graph

**Pick a tree, not a flame graph.** Rationale:

- ZeroU's branches are *static* (AST), not runtime-sampled. A flame graph's
  width = time-spent. ZeroU has no "time spent" axis; forcing one would be a
  lie.
- Branch coverage is the established mental model in QA. JaCoCo / Istanbul /
  Codecov all use trees or gutter-annotated source. The user's brain already
  has a slot for "tree of conditionals".
- A flame graph also hides the empty state (Section 2). Trees can show absent
  arms as explicit dimmed nodes.

The shape: **indented AST tree, left-aligned, one row per branch / arm**.
Each row carries:

- name (`if x > 0` / `else` / `case 'A'` / `try` / `catch (FooError)`)
- a 2×2 micro-grid (4 pips) — one per signal (AST present / runtime hit /
  spec asserts / judge passes), colored red/yellow/green/gray
- a fraction (`3/4 signals`) for at-a-glance counting
- a faint disclosure triangle to expand into children

### Empty state — explicit dashed-red node

Branches the AST proves exist but no signal reached must be **rendered**, not
hidden. Use:

- saturated red left border (matches JaCoCo)
- dashed interior (visually distinct from "ran but failed")
- inline label `never reached` in small caps
- click → "why" panel (showed in next section)

### Drill-down — Speedscope sandwich + Stryker "open mutant"

Click a branch → side panel with:

1. **Sandwich** at top: caller path (3 levels up) + callee preview (3 levels
   down), each as a mini-tree (not flame graph — match the parent visual
   contract).
2. **Source view** in the middle: the actual code for this branch, gutter-
   annotated Codecov-style (hit / partial / miss tri-state markers).
3. **Per-signal "why"** at the bottom: 4 collapsible rows
   - AST: "branch detected at L42:8, type=IfStatement, arm=alternate"
   - Runtime: "0 hits across 14 test runs" *or* "47 hits, all under
     `test/foo.test.ts:88`"
   - Spec: "no spec asserts this branch" *or* "spec L12: 'should reject
     negative input' covers this"
   - Judge: verbatim LLM verdict + quoted evidence

This mirrors Stryker's "click surviving mutant → see the change + which tests
let it through" — the highest-quality drill-down idiom in the test-quality
space.

### Aggregation for big trees — collapse on agreement, expand on disagreement

The 4-signal lattice has a natural collapse rule: **if all 4 signals agree
green for a subtree, collapse it by default** (render as a single green bar
with count "47 branches all-green"). Only expand subtrees with at least one
red or yellow pip. This is the *direct inverse* of pprof's "show everything"
default and a direct fix for the flame-graph anti-pattern (Section below).
This is also how Honeycomb / BubbleUp work conceptually — surface what's
*different*, hide what's uniform.

A second collapse axis: **megafunctions** (>50 branches in one function)
collapse to a histogram strip — like Honeycomb's heatmap row — showing pip
density. Click the strip to expand to full tree. Borrowed from heatmap UX.

### "Self-deceiving highlight" technique — the disagreement glyph

The highest-value pattern, and the one we'd invent:

- When AST says branch exists, runtime says it ran, spec says it's asserted,
  judge says it passes → **muted gray-green**, low visual weight.
- When *any two of those four* disagree → **disagreement glyph**: a small
  asymmetric warning shape (NOT a uniform yellow dot), where the *shape*
  encodes which axes disagree.
  - judge ≠ spec → "spec/judge split" icon (two arrows pointing apart)
  - runtime ≠ spec → "claimed but didn't run" icon
  - AST exists but runtime=0 AND judge=fail → "ghost branch" icon
- Disagreement counts as the headline metric on each function row:
  `foo() — 3 disagreements`.

Why this beats existing tools: every prior-art tool encodes a single axis of
"good vs bad". ZeroU's value is the *disagreement* — places where the test
suite, the spec, and the LLM judge tell different stories about the same
branch. That's where bugs hide. Make disagreement the visual primitive, not
"red" or "uncovered".

### Anti-patterns to avoid

From the survey:

- **Don't ship a flame graph with no aggregation default.** Brendan Gregg's
  own writing notes flame graphs are "too dense to read when spanning
  multiple seconds" without aggregation. ZeroU's worst failure mode is a
  5000-row tree with 12% red rows scattered across it. Collapse all-green
  subtrees by default.
- **Don't show walls of percentages without context.** SonarQube
  dashboards drown the user in `87.3% / 91.2% / 64.0%` numbers with no
  delta and no "which lines specifically". Always pair a % with a fraction
  (`3/12 disagreements`) and a click-to-source.
- **Don't let the tree explode beyond viewport.** PurePath's per-request
  tree is famous for this. The aggregate-collapse + megafunction-histogram
  pattern above is the antidote.
- **Don't hide the empty state.** Sampling-based tools (Datadog, Sentry,
  Dynatrace) literally cannot render "never reached" — that's their blind
  spot, and ZeroU's whole reason for being. The empty-state node must be a
  first-class citizen of the tree.

## 7. Citations

- Datadog Profile Visualizations: https://docs.datadoghq.com/profiler/profile_visualizations/
- Datadog Continuous Profiler timeline view: https://www.datadoghq.com/blog/continuous-profiler-timeline-view/
- Datadog Trace Explorer: https://docs.datadoghq.com/tracing/trace_explorer/
- Datadog flame graph explainer: https://www.datadoghq.com/knowledge-center/distributed-tracing/flame-graph/
- Datadog profiling visualizations blog: https://www.datadoghq.com/blog/profiling-visualizations/
- Dynatrace PurePath blog: https://www.dynatrace.com/news/blog/purepath-visualization-analyze-web-request-end-end/
- Dynatrace PurePath docs: https://docs.dynatrace.com/docs/observe-and-explore/purepath-distributed-traces
- New Relic CodeStream code-level metrics: https://docs.newrelic.com/docs/codestream/observability/code-level-metrics/
- Sentry Profiling docs: https://docs.sentry.io/product/explore/profiling/
- Sentry flame graphs: https://docs.sentry.io/product/explore/profiling/flame-charts-graphs/
- Sentry Differential Flame Graphs: https://docs.sentry.io/product/explore/profiling/differential-flamegraphs/
- Sentry Trace View: https://docs.sentry.io/concepts/key-terms/tracing/trace-view/
- Honeycomb BubbleUp: https://www.honeycomb.io/platform/bubbleup
- Honeycomb Heatmaps + BubbleUp: https://www.honeycomb.io/resources/product-videos/heatmaps-bubbleup-how-they-work
- Codecov line-by-line via GitHub Checks: https://about.codecov.io/blog/announcing-line-by-line-coverage-via-github-checks/
- Codecov PR comments: https://docs.codecov.com/docs/pull-request-comments
- Istanbul docs: https://istanbul.js.org/
- nyc CLI: https://github.com/istanbuljs/nyc
- JaCoCo counters / colors: https://www.eclemma.org/jacoco/trunk/doc/counters.html
- SonarQube code coverage: https://www.sonarsource.com/blog/sonarqube-code-coverage
- pprof README: https://github.com/google/pprof/blob/main/doc/README.md
- Brendan Gregg flame graphs: https://www.brendangregg.com/flamegraphs.html
- Speedscope GitHub: https://github.com/jlfwong/speedscope
- Speedscope sandwich view (Jamie Wong): https://jamie-wong.com/post/speedscope/
- Pyroscope sandwich view blog: https://pyroscope.io/blog/introducing-sandwich-view/
- Grafana sandwich view blog: https://grafana.com/blog/flame-graph-sandwich-view-mode-what-it-is-and-how-to-use-it/
- Chrome DevTools Performance reference: https://developer.chrome.com/docs/devtools/performance/reference
- Stryker mutant states: https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/
- Stryker Mutator: https://stryker-mutator.io/
- PIT mutation testing: https://pitest.org/
- PIT colors explainer (JavaCodeGeeks): https://www.javacodegeeks.com/2026/05/mutation-testing-with-pit-in-java-the-coverage-metric-youre-ignoring-that-actually-measures-test-quality.html
- Diffblue Cover product: https://www.diffblue.com/diffblue-cover/
- Diffblue Cover docs: https://cover-docs.diffblue.com/get-started/what-is-diffblue-cover
- Sealights Coverage Dashboard: https://docs.sealights.io/knowledgebase/coverage-and-quality-insights/coverage-dashboard
- Sealights Test Gap Analysis: https://www.sealights.io/product/test-gap-analysis/
- Polar Signals icicle vs flame: https://www.polarsignals.com/blog/posts/2023/03/28/how-to-read-icicle-and-flame-graphs
- Parca icicle graph anatomy: https://www.parca.dev/docs/icicle-graph-anatomy/
