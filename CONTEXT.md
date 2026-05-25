# CONTEXT — ZeroU domain glossary

> Authoritative shared vocabulary for ZeroU (formerly d2p). All commits / PR titles / code identifiers / spec docs MUST use the terms defined here verbatim. If a concept needs a new term, add it here first, then use it. If the codebase uses an older term that contradicts this file, prefer the term here and treat the code as drift (file an entry in [conflicts-with-v0.7.md](docs/conflicts-with-v0.7.md)).
>
> This file is a **glossary**, not a spec. No implementation details. No file paths beyond pointer references. Resolutions to design questions live in [docs/details/](docs/details/) and [docs/adr/](docs/adr/).

---

## Top-level framing

**ZeroU** is the product. It ships as one CLI + an optional daemon. The product has two halves:

- **Hardener CLI** (`zerou audit`) — the wedge. A single-invocation tool that scans a vibe-coded codebase, produces a list of findings with cross-engine verdicts, and (with `--apply`) proposes fixes. No daemon required.
- **Advanced mode** — the retained demo→product daemon loop from v0.7. Not the default surface; kept runnable; not the focus of public marketing.

Underneath the product sit **three 底座** (foundational protocols) that hardener CLI consumes and that third parties can implement independently:

- **Protocol-1 (P1) — Cross-Engine Reviewer Protocol**
- **Protocol-2 (P2) — Preset Framework**
- **Protocol-3 (P3) — Evidence Bundle Format**

The protocols are **independent**: each has its own surface, its own `version: '1.0'` field, and evolves on its own semver track. A consumer can implement any one protocol without implementing the others.

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
    presets:          { id: string, version: number, manifestSha256: string }[],
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
