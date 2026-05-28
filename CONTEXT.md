# CONTEXT — ZeroU domain glossary

> Authoritative shared vocabulary for ZeroU (formerly d2p). All commits / PR titles / code identifiers / spec docs MUST use the terms defined here verbatim. If a concept needs a new term, add it here first, then use it. If the codebase uses an older term that contradicts this file, prefer the term here and treat the code as drift (file an entry in [conflicts-with-v0.7.md](docs/conflicts-with-v0.7.md)).
>
> This file is a **glossary**, not a spec. No implementation details. No file paths beyond pointer references. Resolutions to design questions live in [docs/details/](docs/details/) and [docs/adr/](docs/adr/).

---

## Top-level framing

**ZeroU** is the product. It ships as a CLI + a local-only React UI; an optional `daemon/` workspace retains the v0.7 demo→product loop ("advanced mode"). The product value proposition is **four tiers — 扫 / 修 / 验 / 追溯** (see `project_zerou_core_value_4tiers` memory):

- **扫 (scan)** — `zerou audit` walks every function and branch via TypeScript AST + runs 13 markdown-preset hardening checks across 11 categories.
- **修 (fix)** — `zerou enhance` injects a production-grade pino logger, a `/health` endpoint, Sentry SDK, `.env.example` completion, and mechanical bug patches; auth-aware emitter handles Supabase-SSR + NextAuth.
- **验 (verify)** — re-runs `npm install` + `tsc --noEmit` + the user's existing test suite + `npm run build`; refuses to ship if any step breaks.
- **追溯 (trace)** — every AST branch carries a stable `branch_id`; runs emit a hash-chained `.zerou/branch-trace.jsonl` in OpenTelemetry wide-event form. `cat | jq | sort -u | wc -l` proves coverage without any UI.

The first three (扫 / 修 / 验) are table-stakes; **追溯** is the differentiator. Per `feedback_zerou_log_as_proof` memory, the log stream IS the proof — not a UI screenshot, not a separate report.

## Scope: application code, not library code

ZeroU's detection patterns are calibrated for application code (route handlers, middleware, lib/utility code of a SaaS app). They generate unacceptable false-positive noise when applied to library internals or vendored third-party code.

Concrete examples of **in-scope** code:

- `app/api/*/route.ts` (Next.js)
- `src/server.ts` + Express / Fastify / Koa / Nest handlers
- `lib/db/client.ts` (app's own data layer)
- `middleware.ts`
- `.env.example`

Concrete examples of **out-of-scope** code:

- `node_modules/`
- vendored deps under `vendor/` or `third_party/`
- minified bundles (`*.min.js`)
- generated TypeScript declarations (`*.d.ts` from build steps)

ZeroU's default `--scope=app` filter skips these. Opt-in with `--scope=all` if you genuinely want library-internal scanning — but expect noise. The scope flag is implemented at the file-walker layer in `cli/src/agent/`; presets do not need scope-awareness themselves.

The 2026-05-28 hardener-bench 3-fixture run is the empirical basis for this scope statement: `zerou-target` (app-layer patterns) gave `P=0.91 R=1.00`; `secbench-subset` (28 real npm package CVEs) gave 406 findings / 0 matches because ZeroU's patterns fired on library internals they were never designed for; `tspr-target` (HTTP behavior bugs needing runtime requests) returned 0 because ZeroU is a static analyzer. Both negative results are "wrong tool" outcomes, not bugs — use Snyk / Socket / `npm audit` for the first, `tspr` / ZAP / Burp for the second.

### User-facing commands

| Command | Tier | Source |
|---|---|---|
| `zerou audit <path>` | 扫 + 测 | `cli/src/audit.ts` |
| `zerou enhance <path>` | 修 + 验 | `cli/src/enhance.ts` |
| `zerou review <path> [--serve]` | viewing | `cli/src/review.ts` |
| `zerou coverage <path>` | 追溯 (gate) | `cli/src/coverage.ts` |
| `zerou trace [id]` | 追溯 (search) | `cli/src/trace.ts` |

### Three protocols (the底座 layer)

Underneath the product sit **three 底座** (foundational protocols) that the audit pipeline consumes and that third parties can implement independently:

- **Protocol-1 (P1) — Cross-Engine Reviewer Protocol**
- **Protocol-2 (P2) — Preset Framework**
- **Protocol-3 (P3) — Evidence Bundle Format**

The protocols are **independent**: each has its own surface, its own `version: '1.0'` field, and evolves on its own semver track. A consumer can implement any one protocol without implementing the others.

### Two domains: A (dev process) vs B (product runtime)

Per `project_zerou_two_domains_separated` memory, "log" / "trace" / "event" always belongs to exactly one of two domains. **Mixing them is a recurring lead mistake; this section is load-bearing.**

| | A — ZeroU dev process | B — ZeroU product runtime |
|---|---|---|
| Actors | lead + subagents + this repo's contributors | end-user running `zerou audit` |
| What "log" means | git commits, vitest output, phase reports, ADRs | structured JSONL events ZeroU emits to `.zerou/logs/<track>/<date>/<trace>.jsonl` |
| Storage | this repo (`docs/`, git history) | user's machine, under the audited project |
| Examples | "Phase 14C shipped at commit `9db0c81`" | "`preset.rule.matched` at `src/x.ts:23`" |

Shared infra (`daemon/src/log/track-logger.ts` from Phase 2 + `cli/src/agent/branch-trace.ts` from Phase 13) supports both — A uses `captureLogsFor` in tests; B writes the user-visible JSONL. **The same TypeScript class serves both, but they are not the same thing.** Before describing any log behavior in this codebase, state which domain.

### Safety model (load-bearing)

Per `feedback_zerou_never_auto_merge` memory:

- `zerou enhance` writes to `.worktrees/zerou-enhance-<ts>/` on a separate branch — **never the user's main**.
- ZeroU **never** auto-merges and **never** pushes to the user's remote.
- The user reviews the diff (via `git diff main..HEAD` or the React UI) and merges manually.
- A future `zerou pr` command (designed, not implemented) will push the enhance branch + open a GitHub PR — the merge button stays with the user.
- `zerou review --serve` binds 127.0.0.1 only; no auth wall, no TLS, no exposure beyond localhost.

---

## Glossary

### 底座 1 — Protocol-1: Cross-Engine Reviewer Protocol

A spec + reference implementation for routing a finding through a second LLM engine (a "critic") whose model family is guaranteed-different from the worker engine, and producing a verdict on whether the finding is real.

The reference implementation is the code that today lives in `daemon/src/engines/router.ts` (`pickCriticEngine` + `engineFamily`), with the verdict shape and engine-failure semantics defined by this protocol. Phase 3 extracts the reference implementation into `core/protocol/cross-engine-reviewer/`.

Protocol-1 owns: critic selection policy, [[verdict]] shape, engine [[family]] classification, [[critic-unavailable]] semantics.

### 底座 2 — Protocol-2: Preset Framework

A spec for declarative check rules: how a check is written (markdown frontmatter + body), how check authors describe what a [[finding]] looks like, how the loader resolves checks from three sources, and how a check's mechanism (deterministic, LLM-augmented, cross-file) is declared.

The reference implementation today lives in `daemon/src/preset/loader.ts` + `presets/*.md` (6 built-in presets). Phase 3 extracts loader + finding types to `core/protocol/preset/`. Third-party plugins ship as `@zerou-preset-*` npm packages.

Protocol-2 owns: [[Finding]] shape, preset [[manifest]] schema, [[mechanism]] enumeration, preset [[lookup chain]].

### 底座 3 — Protocol-3: Evidence Bundle Format

A spec for the canonical audit artifact: a JSON file containing a set of verdicted findings plus the metadata needed to re-run the audit and reach the same verdicts ("auditable" reproducibility, not byte-exact).

Phase 1 only sets the bundle skeleton (consumed by hardener CLI `--out report.json`). Full P3 spec + Vercel/Netlify deployment-check adapter PoC is Phase 3 (Week 4).

Protocol-3 owns: [[EvidenceBundle]] JSON shape, the "auditable" reproducibility contract (file sha256, engine kind + full model ID + release date, preset id + version), bundle merging semantics.

### 应用层 — Hardener CLI

The user-facing CLI command `zerou audit <path>`. It is a single-invocation tool: no daemon, no SQLite session, no resume. It composes Protocol-2 (run presets, get findings), Protocol-1 (route findings through critic engines, get verdicts), and Protocol-3 (assemble findings + verdicts + metadata into an EvidenceBundle). The application layer is the only place the three protocols are wired together.

Hardener CLI is the wedge product; the protocols are the underlying capabilities.

### Finding

A single observation produced by one preset check on one location in the audited repo. The atomic unit of Protocol-2 output. Shape (canonical):

```
{
  id:                          string,    // <presetId>.<shortHash>, see [[Finding ID]]
  presetId:                    string,    // owner preset's id (e.g. "secrets-leak")
  ruleId:                      string,    // check within preset (e.g. "hardcoded-stripe-key")
  severity:                    'P1' | 'P2' | 'P3',
  file:                        string,    // repo-relative path
  line:                        number,    // 1-based
  evidence:                    string,    // verbatim matched content (may be truncated)
  matched_content_normalized:  string,    // strip whitespace + lowercase
  message:                     string,    // human-readable single sentence
  remediationHint:             string | null,
  version:                     '1.0',
}
```

A Finding has no verdict — it is a raw observation. Adding a verdict promotes it to a [[VerdictedFinding]].

### Finding ID

Composite identifier: `<presetId>.<shortHash>` where `shortHash = sha1(file + ':' + line + ':' + ruleId + ':' + matched_content_normalized).slice(0, 8)`.

The `matched_content_normalized` term in the hash means that purely cosmetic line shifts (a user adds a comment at the top of a file) do not break Finding ID stability across audit runs. Real content changes do break it. This is the cornerstone of cross-run [[bundle merge]] dedup.

### Verdict

A judgment on whether a single [[Finding]] represents a real problem. Values:

- `'confirmed'` — the critic engine agrees the finding is real
- `'false-positive'` — the critic engine says the finding is wrong
- `'needs-context'` — the critic engine cannot decide without more information; MUST carry a non-empty `requiredContext: string[]` listing what is missing (empty array is equivalent to `false-positive`)
- `'critic-unavailable'` — the critic engine could not be invoked (no second engine configured, rate-limited, transport error, etc.); the finding is presented to the user with this status so they can configure a second engine and re-run

Demo→product mode has its own unrelated `Verdict` type with values `'APPROVE' | 'RETRY_WITH_HINTS' | 'ROLLBACK' | 'ESCALATE'`. The two types are in different namespaces and MUST NOT be unified. See [conflicts-with-v0.7.md C-001](docs/conflicts-with-v0.7.md).

### VerdictedFinding

A [[Finding]] plus the verdict layer:

```
Finding & {
  verdict:           Verdict,
  critic: {
    engineKind:      string,            // e.g. "anthropic-api"
    modelId:         string,            // e.g. "claude-haiku-4-5-20251001"
    releaseDate:     string,            // ISO 8601, e.g. "2025-10-01"
    family:          string,            // see [[family]]
  } | null,                              // null iff verdict === 'critic-unavailable'
  reasoning:         string | null,
  requiredContext:   string[] | null,    // present iff verdict === 'needs-context'
  version:           '1.0',
}
```

Protocol-1 owns this shape.

### EvidenceBundle

The canonical audit artifact. Output by hardener CLI under `--out <path>.json`. Phase 1 skeleton:

```
{
  bundleId:           string,           // ULID
  zerouVersion:       string,
  audit: {
    startedAt:        string,           // ISO 8601
    endedAt:          string,
    cwd:              string,           // absolute path on the author's machine
    repoSha:          string | null,    // git HEAD sha after auto-init
    presets:          { id: string, version: number, manifestSha256: string, shadowedBy: ('plugin' | 'project' | 'builtin')[] }[],
    engineConfig:     { workerKind, workerModelId, workerReleaseDate, criticKind?, criticModelId?, criticReleaseDate? },
  },
  findings:           VerdictedFinding[],
  inputFiles:         { path: string, sha256: string }[],   // every file actually read by a preset check
  summary: {
    counts:           { confirmed: number, falsePositive: number, needsContext: number, criticUnavailable: number },
    byPreset:         Record<string, { confirmed, falsePositive, needsContext, criticUnavailable }>,
    failOnThreshold:  'p1' | 'p2' | 'p3' | 'none',
    exitCode:         number,
  },
  version:            '1.0',
}
```

Protocol-3 owns this shape. Phase 1 dev doc covers the skeleton; Phase 3 P3 dev doc covers merging, deployment-check adapters, and signing.

### preset

A single declarative check unit, expressed as a markdown file with a frontmatter manifest and a markdown body (rationale + remediation prose). One preset owns one [[ruleId]] namespace and may produce zero or more [[Finding]]s when run.

The 6 built-in presets in `presets/*.md` (cli-tool, api-service, saas-web, library, static-site, unknown) are **legacy** project-type presets — they were designed for the demo→product `Gap` framing. The hardener pivot adds a new generation of cross-cutting presets (`secrets-leak`, `supabase-rls`, `authz-bola` — the "first 3 vibe-coded presets") that apply regardless of project type. Both generations live under [[lookup chain]].

### preset detection step

One unit of work inside a preset's body — corresponds to one [[ruleId]]. A preset runs all of its detection steps when invoked; each step produces zero or more findings.

### manifest

A preset's YAML frontmatter. Phase 2 of Protocol-2 (Phase 1 spec) finalizes the v0.2 schema: `id`, `version`, `appliesTo`, `mechanism`, `severity`, `description`, `dependsOn`, plus optional `llmPolicy` block for LLM-augmented checks.

### mechanism

How a single [[preset detection step]] decides whether a finding exists. One of:

- `static-grep` — regex / AST match on file contents
- `file-exists` — presence/absence of a path
- `test-execution` — running a checker (typecheck, lint, deps audit)
- `cross-file-cohesion` — multi-file deterministic analysis (e.g. .env vars vs .env.example coverage)
- `llm-judgment` — sends content to an LLM and parses a JSON verdict

`llm-judgment` steps are the ones that hit the [[critic engine]] for a second-opinion pass through Protocol-1; deterministic mechanisms still go through Protocol-1 but the critic typically marks them `'confirmed'` without LLM cost.

### lookup chain

Three-source resolution order for presets (high overrides low):

1. `node_modules/@zerou-preset-*/preset.md` — third-party npm plugins
2. `<repo>/.zerou/presets/*.md` — project-local override
3. `<zerou install>/presets/*.md` — built-in defaults

When the same preset `id` appears at two levels, the higher-priority source wins and hardener CLI prints a `warn: preset <id> overridden by <higher-priority-source>` line. **Silent override is forbidden.**

### critic engine

The second LLM engine, of a different [[family]] from the worker, that produces verdicts on findings via Protocol-1. Selected from a configured pool; when no pool member is in a different family from the worker, the verdict becomes `'critic-unavailable'`.

### family

A coarse-grained grouping of LLM engines for decorrelation purposes. Two engines share a family iff their underlying model lineage is shared. Current canonical families:

- `anthropic` — covers `claude-cli` and `anthropic-api`
- `openai` — covers `codex-cli`
- `google` — covers `gemini-cli`
- For `openai-compat`, the family is the hostname of the configured baseUrl (so `api.deepseek.com`, `api.minimaxi.chat` etc. are distinct families from each other and from `openai`)

The decorrelation theory: a critic in a different family is less likely to share the worker's blind spots (Knight-Leveson 1986 N-version independence applied to LLM lineage).

### critic-unavailable

A [[Verdict]] value indicating Protocol-1 could not produce a real verdict (no second-family engine configured, transport error, rate-limit exhaustion, etc.). Hardener CLI surfaces this in the end-of-run summary with a nudge to configure a second engine.

### fix template

A deterministic codemod bundled with a preset. When `--apply` is requested and a finding has a fix template, the template is applied verbatim (no LLM). High confidence.

### fix proposal

When `--apply` is requested and a finding has no fix template, the [[critic engine]] is asked to propose a patch AND a verification step (the [[verify step]]) in a single invocation. The proposal is only applied if the verify step confirms the original finding no longer reproduces. Without a successful verify, the fix is shown to the user with a `'LLM (unverified)'` banner and `--apply` MUST refuse to write the change.

### verify step

The "did the fix actually fix it" check the LLM must include in any fix proposal (Q4 micro). Typically a command that reruns the original detection step on the patched file. The proposal is rejected if the verify step is missing or if the verify step still detects the original finding.

### track

A logical grouping used by the [[TrackLogger]] log module. Tracks are stable module identifiers (`hardener`, `preset`, `critic`, `cli`, etc.) — they classify *where* a log entry originated. A single audit invocation writes log entries across multiple tracks, all sharing one [[trace]] ID.

### trace

A ULID generated once per CLI invocation. All log entries from the same invocation share the same trace ID across tracks. Used to reconstruct the full causal chain of one audit run from log files.

### scope

A sub-namespace within a track, attached via `logger.child(scope)`. A scope refines location within a track (e.g. `track=preset` + `scope=secrets-leak.scan`).

### bundle merge

Combining two [[EvidenceBundle]]s from separate audit runs on the same repo into one. Dedup key is [[Finding ID]]; two findings with the same ID across bundles collapse to one entry (later bundle's verdict wins). Spec'd in Phase 3 P3 doc.

### advanced mode

The demo→product daemon loop that was the v0.7 default. Retained as runnable code under `daemon/src/orchestrator/loop.ts` + `daemon/src/agents/*`. Not the public-facing default. No new features after the pivot; bug fixes only if they block the hardener path.

---

## Audit-loop vocabulary (Phases 5 / 8 / 9-lite / 11)

### TestCaseSpec

A single generator-emitted test specification: `{ id, name, given, when, then, category, scope: { file, line }, reasoning }`. Emitted by `agent/test-case-generator.ts` using the red-team prompt (Phase 9 Lite-2 — see `2026-05-26-phase-9-lite-adversarial-judge.md`). The generator MUST emit ≥1 spec per applicable item from a 10-item attack-surface checklist (input boundary / validation gaps / auth bypass / data exposure / storage hygiene / error handling / concurrency / resource / trust boundary / happy path).

### TestCaseResult

The judge's verdict for one spec: `{ specId, status: 'pass' | 'fail' | 'inconclusive', verdictReason, evidence: { file, line, snippet, expectedBehavior, actualBehavior } }`. Emitted by `agent/test-spec-runner.ts` under the adversarial prompt — default verdict = `fail`, must quote the proving line to flip to `pass`. The runner prompt MUST NOT include `spec.id` / `spec.category` / `spec.reasoning` (information isolation contract, locked by tests).

### AuthShape

Phase 11.3 (`2026-05-27-phase-11-3-patcher-auth.md`). Discrete-union shape returned by `agent/auth-detector.ts`:

- `{ kind: 'supabase-ssr', helperImport: string }`
- `{ kind: 'next-auth', sessionImport: string }`
- `{ kind: 'none' }`

Threaded through generator → runner → emitter. Emitter consumes the shape via `auth-fixtures.ts` to emit canonical `vi.mock(...)` blocks so generated tests can simulate "authenticated user" or "anonymous request". Conservative when ambiguous → `'none'`.

### AuditFinding

Phase 11.3 union shape consumed by `enhance/bug-patcher.ts`. Sources:

1. Static markdown table (`## Static Hardening Findings`) parsed by `readAuditFindings` in `enhance.ts`.
2. `TestCaseResult[]` with `status='fail'` converted by `enhance/test-fail-to-finding.ts`. Severity mapping: security/auth → P1, validation/error-handling → P2, edge-case/other → P3.

Both sources are unioned before the patcher runs. The "33 fails reach the patcher" architectural fix is the entire point of Phase 11.3.

---

## Branch-coverage vocabulary (Phase 11.5 + 13 + 14)

### BranchNode

Phase 11.5 (`2026-05-27-phase-11-5-branch-coverage-tree.md`). One AST branch in a function:

```
{
  branchId: string;        // file:fn@line:kind-direction#n
  kind: 'if-true' | 'if-false' | 'switch-case' | 'try' | 'catch'
       | 'finally' | 'ternary' | 'short-circuit' | 'loop-body';
  line: number;
  signals: { ast: true; spec: boolean; judge: boolean; run: boolean | null };
  verdict: BranchVerdict;
}
```

The 4 signals are independent observations of the same branch:

1. **AST** — does the branch exist? (TS Compiler API).
2. **SPEC** — does any `TestCaseSpec.then` mention this branch's line range?
3. **JUDGE** — does any `TestCaseResult.evidence.snippet` quote a line inside this branch?
4. **RUN** — does vitest c8/istanbul show ≥1 hit in the line range? (`null` when c8 didn't run user code, downgrading verdict to `'unknown'` rather than false-claiming `'covered'`.)

### BranchVerdict

| Value | Signals (spec / judge / run) | Meaning |
|---|---|---|
| `covered` | ✓ ✓ ✓ | tests prove it works |
| `judge-only` | ✓ ✓ ✗ | **self-deceiving** — judge pointed at it, runtime didn't see it |
| `spec-only` | ✓ ✗ ✗ | spec mentioned, no evidence |
| `run-only` | ✗ (any) ✓ | incidental execution; no spec covers the intent |
| `untested` | ✗ ✗ ✗ | no signals lit |
| `unknown` | run signal unavailable | cannot decide |

The `judge-only` case is the marquee "self-deception detector" — it catches LLM-judge confidence not backed by runtime evidence.

### 5th signal — log emit (planned, not shipped)

Per `project_zerou_log_benchmark_priority` memory + `project_zerou_benchmark_deferred` memory. The fifth signal would be: "did the runtime emit a structured log line tagged with this `branch_id`?" The Phase 13 `branch-trace.jsonl` schema can carry it; the implementation that injects per-branch `logBranch(...)` calls is enhance Module B–scoped work, but the audit-then-enhance ordering issue raised in `2026-05-27-zerou-benchmark-critique-v1.md` (Attack #2) is unresolved. Treat the 5-signal model as documented-but-deferred.

### BranchTraceEvent

Phase 13 (`2026-05-27-phase-13-log-as-proof.md`). One wide-event JSONL line under `.zerou/branch-trace.jsonl`:

```
{
  trace_id, span_id,
  event: 'branch.evidence',
  branch_id,
  'code.function', 'code.file.path', 'code.line.number',
  signals, verdict, evidence,
  seq, prev_hash, hash
}
```

Field names follow OpenTelemetry semantic conventions (`code.*`). The `seq` / `prev_hash` / `hash` triple is a SHA-256 hash chain — `zerou coverage --verify-chain` re-walks it and exits 5 on mismatch with `last_good_seq` reported. Determinism contract: same `BranchCoverageReport` → byte-identical JSONL.

### Coverage modes (`zerou coverage`)

Phase 13.2. Reads `branch-trace.jsonl` line-by-line via `readline` (never `readFileSync` the whole file — the 600 KB streaming test pins this).

- **Default** — counts branches whose verdict ∉ `{ 'untested', 'unknown' }`.
- **Strict** (`--strict`) — counts only `verdict === 'covered'` (all signals lit).

Exit codes: `0` ok / `1` below threshold / `2` bad args / `4` missing artifact / `5` hash chain broken.

---

## Branch state machine (Phase 14.5)

`2026-05-28-phase-14-pipeline-ui.md` + `ui/src/lib/branchState.ts`. The UI overlay model that animates the audit pipeline live.

| State | Glyph | Color | Meaning |
|---|---|---|---|
| `pending` | ○ | gray | not yet evaluated |
| `evaluating` | ↻ | coral (spin) | LLM-judge call in flight |
| `covered` | ✓ | forest green | terminal pass |
| `mechanical-red` | ✗ 🔧 | rust + wrench | terminal fail, patcher could attempt |
| `business-red` | ✗ 🔒 | rust + lock | terminal fail, needs human review |
| `retrying` | ↻ | coral + N/M counter | transient mid-retry |

Aggregation: dir / file / fn level pick the **worst** state of their descendants. Heat strip surfaces files by attention rank — `business-red` first, `covered` last. The conservative heuristic for unknown categories biases toward `business-red` so ZeroU never over-promises auto-fix capability (`feedback_zerou_log_as_proof` style "no self-deception").

### Live update channel

The React UI subscribes to `GET /api/stream` (SSE) on the local review server. Events:

- `branch-trace.append` — one branch verdict landed
- `log.append` — one structured log line landed
- `bundle.refresh` — audit/enhance completed; React re-fetches `review-data.json`
- `heartbeat` — every 15s

Backed by `cli/src/agent/branch-trace-stream.ts` (`BranchTraceStream` class with `append` / `emitTransition` / `close`) wired into `audit.ts` BEFORE the `test-spec-runner` batch — each spec emits `state='evaluating'` before the LLM call and a terminal state after.

---

## Decision sources + memory pointers

| Topic | Source |
|---|---|
| 4-tier value (扫修验追溯) | `project_zerou_core_value_4tiers` memory |
| Log+benchmark as top priority | `project_zerou_log_benchmark_priority` memory |
| Benchmark v1 deferred | `project_zerou_benchmark_deferred` memory + `docs/reviews/2026-05-27-zerou-benchmark-critique-v1.md` |
| Two domains discipline | `project_zerou_two_domains_separated` memory |
| Never auto-merge | `feedback_zerou_never_auto_merge` memory |
| Log-as-proof | `feedback_zerou_log_as_proof` memory + `docs/reviews/2026-05-27-log-as-proof-prior-art.md` |

---

## Phase 1 decisions (Q1–Q12) — quick-reference table

| Q | Topic | Decision |
|---|---|---|
| Q1 | Finding ownership | P2 owns `Finding` / P1 owns `VerdictedFinding` / P3 owns `EvidenceBundle` (single-direction data flow) |
| Q1.μ | Verdict namespace | Hardener `Verdict` is a new type; demo→product `Verdict` untouched. See [conflicts C-001](docs/conflicts-with-v0.7.md) |
| Q1.μ | needs-context contract | MUST carry non-empty `requiredContext: string[]` |
| Q1.μ | Surface versioning | Every protocol surface declares `version: '1.0'`; semver evolution per protocol |
| Q2 | Preset lookup | 3-layer: `node_modules/@zerou-preset-*` > `<repo>/.zerou/presets/` > built-in; warn-on-override |
| Q3 | Critic dispatch | Concurrent per-finding; default concurrency 5; drops to serial on cost-cap pressure |
| Q4 | Fix source | Template > LLM fallback; LLM proposal must include verify step or `--apply` refuses |
| Q5 | EvidenceBundle reproducibility | "Auditable" = file sha256 + engine kind + full model ID + release date + preset id + version |
| Q6 | Hardener isolation | Standalone CLI process, zero daemon dependency; engine abstraction moves to `core/` for shared consumption |
| Q7 | Log namespace | Two-layer: stable `track` (module) + ULID `trace` (per invocation); `child(scope)` refines within track |
| Q8 | BYO-key config | 3-layer: `--key` flag > `ZEROU_<PROVIDER>_KEY` env > `~/.zerou/config.json` (chmod 600); flag value redacted in process listings/logs |
| Q9 | Exit code | Default A (data via report, not exit code); `--fail-on=p1|p2|p3|none` opt-in gate |
| Q10 | Finding ID | `<presetId>.<shortHash>`, shortHash inputs include `matched_content_normalized` so line shifts don't break dedup |
| Q11 | Critic failure mode | `'critic-unavailable'` 4th verdict value; end-of-run summary nudges single-engine users |
| Q12 | Cwd handling | Auto `git init` if non-git; refuse to run on a git repo with uncommitted changes unless `--allow-dirty` |

---

## Grill session notes (2026-05-25)

Source: `/grill-with-docs` session run by worker on this date, lead approval batch reply same day.

Grill identified Q1 (Finding shape ownership) as the highest-leverage boundary question: getting it wrong means all four Phase-1 tracks step on each other's surfaces. Resolution C (three-segment naming, single-direction data flow, each protocol owns one shape) was chosen specifically because it lets the four dev-doc tracks proceed in parallel with no shared mutable surface.

Q3 / Q4 / Q11 are the three places where the BYO-key default reality (most vibe-coder users will configure exactly one engine) forces ergonomic compromises: concurrent critic dispatch with degradation under cost pressure (Q3), LLM-generated fixes that require self-verification before being applied (Q4), and an explicit `'critic-unavailable'` verdict instead of silently faking confidence (Q11).

Q10's micro-adjustment (adding `matched_content_normalized` to the Finding ID hash inputs) came from a real failure mode: the original `file+line+ruleId` hash breaks dedup whenever a user adds a comment to the top of a file — every downstream finding would get a new ID and `bundle merge` would treat them all as new. Normalizing matched content into the hash fixes this without making the ID dependent on cosmetics.
