# 13 — Protocol-2 Preset Framework Spec (Track P2)

> SPEC-SPLIT artifact, Phase 1. Sibling files:
> [public-surface](./13-protocol-2-public-surface.md) · [tests](./13-protocol-2-tests.md) · [comparison-report](./13-protocol-2-comparison-report.md)

---

## 1. Goal

Declarative preset framework: third parties (and built-ins) define checks as markdown files; the loader resolves them through a 3-layer lookup chain; running them produces canonical `Finding` objects that Protocol-1 consumes.

## 2. Non-goals

1. **No verdict on findings** — P2 only produces raw observations. Verdicts are Protocol-1's domain.
2. **No fix application** — `--apply` orchestration is in hardener CLI (Track A); P2 only declares whether a preset *has* a fix template per rule.
3. **No preset sharing protocol** — P2 does not define a registry, signing, trust chain, or discovery protocol. Third-party plugins ship as plain npm packages and the user installs them with `npm i`.
4. **No cross-preset dependency resolver** — a preset that depends on another preset's output is out of scope for v0.2. Each preset runs independently against the repo.
5. **No backwards compatibility with `presets/*.md` v0 frontmatter** — the existing 6 presets MUST migrate to v0.2 frontmatter. The migration path is mechanical (documented in §4.5).
6. **No remote preset fetching at runtime** — the loader only reads from local disk. Pre-installing via `npm` is the supported workflow; on-demand fetch is explicitly out.

## 3. Public surface

Authoritative shape lives in [13-protocol-2-public-surface.md](./13-protocol-2-public-surface.md). Summary:

- `Finding` shape (owned here; consumed by P1 + P3).
- `PresetManifest` schema (v0.2 frontmatter shape).
- `PresetMechanism` enum: `'static-grep' | 'file-exists' | 'test-execution' | 'cross-file-cohesion' | 'llm-judgment'`.
- `loadPreset(id, opts?)` — resolves through 3-layer lookup chain.
- `listPresets(opts?)` — enumerates all presets across all layers, returning manifests + resolved source.
- `runPreset(manifest, ctx, opts?)` — executes a loaded preset against a repo context, returns `Finding[]`.
- `LookupSource = 'plugin' | 'project' | 'builtin'` — surfaced on every loaded preset for warn-on-override.

All entry points accept an optional `logger: TrackLogger` (from Track L); when omitted, the module constructs a default logger with `track='preset'`.

## 4. Internal design

### 4.1 Three-layer lookup chain

```
Priority (high → low):
  1. Plugin    — node_modules/@zerou-preset-<name>/preset.md
  2. Project   — <repo>/.zerou/presets/<id>.md
  3. Builtin   — <zerou install dir>/presets/<id>.md   (the 6 legacy presets after migration)
```

Resolution rules:

- `loadPreset(id, opts)` walks the chain top-to-bottom; first hit wins.
- When the same `id` appears at multiple layers, the higher-priority source wins AND the loader emits an `info`-level log event `preset.lookup.shadowed` listing the shadowed sources. **Silent override is forbidden.**
- `listPresets` returns one entry per `id`, marking which layer the chosen source came from, and includes a `shadowedBy: LookupSource[]` field listing layers where the same id was shadowed.

Default discovery paths come from the merged resolver:

| Layer | Default path | Override mechanism |
|---|---|---|
| Plugin | `${repo}/node_modules/@zerou-preset-*/preset.md` (glob; one preset per package) | `ZEROU_PRESET_PLUGIN_DIRS` env (colon-separated extra dirs) |
| Project | `${repo}/.zerou/presets/*.md` | `--presets <dir>` on hardener CLI (Track A) |
| Builtin | bundled with the npm package, resolved relative to module location | `ZEROU_PRESET_BUILTIN_DIR` env (test override) |

### 4.2 Manifest schema v0.2

```yaml
---
id:           cli-tool                   # required, slug, [a-z][a-z0-9-]{1,63}
version:      2                          # required, positive integer (manifest format version, not preset content version)
name:         "CLI tool readiness"       # required
appliesTo:    ["C"]                      # optional; letters from PROJECT_TYPE_LETTERS. Omitted = all types.
dependsOn:    []                         # optional; list of preset ids that should run first (advisory only in v0.2; no resolver)
rules:                                   # required (≥1 entry)
  - ruleId:       readme-quickstart
    label:        "README has fenced install + run block"
    severity:     P1                     # P1 | P2 | P3
    mechanism:    static-grep            # see PresetMechanism enum
    source:       "base"                 # human attribution, free-form
    rationale:    >                      # optional; falls back to body section
      A README without a runnable install/run block is friction.
    detection:                           # mechanism-specific config
      patterns: ["```(sh|bash|console)"]
    fix:                                 # optional; presence enables --apply for this rule
      kind:       template               # template | llm-only
      ...                                # template config (see §4.4)
    llmPolicy:                           # optional; required when mechanism === 'llm-judgment'
      criticEnforce: true                # P1-controlled; see Protocol-1 spec §4
      maxTokens:    2000
---

(markdown body — used for human-facing remediation copy displayed in hardener
CLI report; not parsed for execution semantics)
```

Strict validation: any unknown top-level frontmatter key, any unknown rule field, any rule with `mechanism: 'llm-judgment'` and no `llmPolicy` block — all cause `loadPreset` to throw `PRESET-E-2`.

### 4.3 `Finding` shape (owned by P2)

```typescript
export interface Finding {
  id:                          string;                 // <presetId>.<shortHash>, see §4.6
  presetId:                    string;
  ruleId:                      string;
  severity:                    'P1' | 'P2' | 'P3';
  file:                        string;                 // repo-relative POSIX path
  line:                        number;                 // 1-based; 0 for whole-file findings
  evidence:                    string;                 // verbatim matched content, max 2 KB (truncated with "...")
  matched_content_normalized:  string;                 // strip-whitespace + lowercase of evidence
  message:                     string;                 // single human sentence
  remediationHint:             string | null;          // ≤200 chars; null when only the body markdown applies
  fixAvailable:                'template' | 'llm-only' | null;   // presence of preset-declared fix
  version:                     '1.0';
}
```

Producers (preset runners) MUST construct `id` via the canonical helper exposed from the surface (`buildFindingId(...)`) — manual concatenation forbidden.

### 4.4 `runPreset` execution model

Inputs:
- `manifest: PresetManifest` (from `loadPreset`)
- `ctx: RunContext = { cwd: string, repoSha: string | null, fileFilter?: (path: string) => boolean }`
- `opts: { logger?: TrackLogger, criticPolicy?: CriticPolicy }` (criticPolicy is forwarded into `llm-judgment` rules — Protocol-1 owns the actual call)

Output:
- `Promise<Finding[]>`

Per-rule dispatch:

| `mechanism` | Implementation in v0.2 |
|---|---|
| `static-grep` | Run regex(es) against `ctx.fileFilter`-filtered repo files; one `Finding` per match. Multi-pattern config supported. |
| `file-exists` | Check existence (or non-existence per rule config) of declared paths under `cwd`. |
| `test-execution` | Spawn declared command in `cwd`; success/failure interpretation comes from rule config (`failOn: 'exitCode' \| 'stderrPattern'`). |
| `cross-file-cohesion` | Run declared analyzer (e.g. `.env-vs-env.example coverage`); produces ≥0 findings with rule-specific evidence. |
| `llm-judgment` | Render rule's prompt template; delegate the LLM call to the supplied `criticPolicy.critic` engine (Protocol-1 boundary). The returned LLM JSON is mapped to ≥0 findings per the rule config. |

The 4 deterministic mechanisms are implemented in the v0.2 reference impl (this spec). `llm-judgment` is fully spec'd here but the actual LLM dispatch is Protocol-1's job — P2 only renders the prompt + parses the response.

### 4.5 Migration of legacy `presets/*.md`

The 6 existing presets in `presets/*.md` (cli-tool, api-service, saas-web, library, static-site, unknown) use a v0 frontmatter shape that lists `items[]` of `{id, label, severity, mechanism, source, appliesTo}` directly. The hardener pivot retains them as built-in presets but they MUST be rewritten under the v0.2 schema:

1. `type: cli-tool` → `id: cli-tool`
2. `items[]` → `rules[]` (rename + add `ruleId`, `detection` blocks per mechanism, `fix` block where applicable)
3. The implicit `items: corePresetItemsForType(type)` fallback in `loader.ts:92-94` is gone — every rule MUST be declared explicitly in v0.2 (no implicit core-list inheritance).
4. The 32-item `PRESET_CORE_ITEMS` table in `items-core.ts:28` becomes the *spec* of the legacy preset content; the rewrite is mechanical, not creative.

Migration is Phase 3 work, not Phase 1. This spec only fixes the target shape.

### 4.6 Finding ID construction

```
shortHash = sha1(`${file}:${line}:${ruleId}:${matched_content_normalized}`).digest('hex').slice(0, 8)
id = `${presetId}.${shortHash}`
```

The use of `matched_content_normalized` (whitespace-stripped + lowercased evidence) means cosmetic file-top changes (added comments, reformatting) do not change finding IDs. Real content drift does.

### 4.7 Module layout (Phase 3 target — not implemented in Phase 1)

```
core/protocol/preset/
├── types.ts                      # Finding, PresetManifest, PresetMechanism, etc.
├── loader.ts                     # 3-layer lookup chain; manifest parse + validate
├── runner.ts                     # runPreset() — mechanism dispatch
├── finding-id.ts                 # buildFindingId() helper
├── mechanisms/
│   ├── static-grep.ts
│   ├── file-exists.ts
│   ├── test-execution.ts
│   ├── cross-file-cohesion.ts
│   └── llm-judgment.ts           # imports Protocol-1 critic; no LLM SDK here
└── index.ts                      # surface re-exports
```

Phase 1 does not implement this. The existing `daemon/src/preset/loader.ts` is the v0 reference. Phase 3 rewrites under v0.2 with the layout above.

## 5. Failure modes

| Code | Condition | Behavior |
|---|---|---|
| `PRESET-E-1` | `loadPreset(id)` finds no match across any layer | Throws synchronously: `PRESET-E-1: preset <id> not found`. |
| `PRESET-E-2` | Manifest frontmatter fails schema validation (unknown key, missing required field, type mismatch) | Throws synchronously: `PRESET-E-2: invalid manifest <id>: <zod issue list>`. |
| `PRESET-E-3` | `rules[]` is empty or duplicate `ruleId` within one preset | Throws synchronously: `PRESET-E-3: <id> has 0 rules` or `PRESET-E-3: <id> has duplicate ruleId <r>`. |
| `PRESET-E-4` | `mechanism: 'llm-judgment'` without `llmPolicy` block | Throws synchronously: `PRESET-E-4: rule <id>.<ruleId> needs llmPolicy`. |
| `PRESET-E-5` | Plugin layer glob hits more than one manifest in one `@zerou-preset-*` package | Throws synchronously: `PRESET-E-5: plugin package <pkg> has multiple preset.md files`. |
| `PRESET-E-6` | A `static-grep` regex is malformed | `loadPreset` throws `PRESET-E-6`; the offending pattern is named. |
| `PRESET-E-7` | `runPreset` encounters a rule whose required `criticPolicy` is missing (LLM rule but caller did not pass one) | Throws `PRESET-E-7: rule <id>.<ruleId> requires criticPolicy`; the partial-results contract is documented (other rules already executed; their findings are returned with the error). |
| `PRESET-E-8` | `runPreset` rule execution timeouts (per-rule cap from manifest, default 60s) | The rule is treated as producing one synthetic finding with `severity: 'P3'`, `message: 'rule timed out'`. Logged as `preset.rule.timeout`. Other rules continue. |
| `PRESET-E-9` | Override conflict (same `id` in two layers) | NOT an error — emits log `preset.lookup.shadowed`. Loading succeeds with the higher-priority source. |

## 6. Logging Contract

### 6.1 Track name

Default `track: 'preset'`. Callers MAY pass an alternate logger (e.g. `track: 'cli'` for invocations through hardener CLI's outer logger); the module uses the supplied logger as-is.

### 6.2 Required events

| Event name | Level | When | Required fields |
|---|---|---|---|
| `preset.load.start` | `info` | `loadPreset` enters | `presetId: string`, `requestedFrom: 'caller'` |
| `preset.load.resolved` | `info` | A layer's file was selected | `presetId`, `source: LookupSource`, `path: string` |
| `preset.load.shadowed` | `info` | `listPresets` discovers same id in multiple layers | `presetId`, `winningSource: LookupSource`, `shadowedSources: LookupSource[]` |
| `preset.load.success` | `info` | Manifest validated, returned | `presetId`, `version: number`, `rulesCount: number` |
| `preset.load.failure` | `error` | Any `PRESET-E-1..6` thrown | `presetId`, `errorCode: string`, `error: string` |
| `preset.run.start` | `info` | `runPreset` enters | `presetId`, `rulesCount: number` |
| `preset.run.rule.start` | `debug` | Per rule | `presetId`, `ruleId`, `mechanism` |
| `preset.run.rule.finding` | `debug` | A finding is produced | `presetId`, `ruleId`, `findingId`, `severity`, `file`, `line` |
| `preset.run.rule.success` | `info` | Rule completes (zero or more findings) | `presetId`, `ruleId`, `findingsCount: number`, `durationMs: number` |
| `preset.run.rule.timeout` | `warn` | PRESET-E-8 | `presetId`, `ruleId`, `timeoutMs: number` |
| `preset.run.rule.failure` | `error` | Mechanism implementation threw (not E-7/E-8) | `presetId`, `ruleId`, `error: string` |
| `preset.run.success` | `info` | runPreset completes | `presetId`, `findingsCount: number`, `durationMs: number` |
| `preset.run.failure` | `error` | PRESET-E-7 (no critic policy) | `presetId`, `ruleId`, `errorCode: 'PRESET-E-7'` |

### 6.3 Required child scopes

| Scope | Used by | Internal events |
|---|---|---|
| `parse` | Manifest YAML+markdown parsing inside `loadPreset` | `parse.start`, `parse.success`, `parse.failure` |
| `validate` | Zod schema validation inside `loadPreset` | `validate.start`, `validate.success`, `validate.failure` |
| `mechanism.<name>` | Each rule dispatch (`mechanism.static-grep`, `mechanism.llm-judgment`, etc.) | mechanism-specific |

### 6.4 Behavior ↔ Log event reverse lookup

| Behavior ID | Log assertion |
|---|---|
| B-1-1 | After `loadPreset('cli-tool')`, logs contain `preset.load.start` then `preset.load.resolved` then `preset.load.success`, all with `presetId: 'cli-tool'` |
| B-1-2 | When the preset doesn't exist, logs contain `preset.load.failure` with `errorCode: 'PRESET-E-1'` |
| B-2-1 | When plugin and project both define the same id, logs contain `preset.load.shadowed` with `winningSource: 'plugin'` and `shadowedSources: ['project', 'builtin']` (or subset) |
| B-2-2 | `loadPreset` for a shadowed id returns the plugin-layer manifest |
| B-3-1 | Validation failure (e.g. unknown frontmatter key) emits `preset.load.failure` with `errorCode: 'PRESET-E-2'` |
| B-3-2 | `llm-judgment` rule without `llmPolicy` block emits `preset.load.failure` with `errorCode: 'PRESET-E-4'` |
| B-4-1 | `runPreset` for a 3-rule preset emits 3× `preset.run.rule.start` and `preset.run.rule.success` events |
| B-4-2 | Each produced finding has a matching `preset.run.rule.finding` event with `findingId === finding.id` |
| B-4-3 | `runPreset` invocation lacking `criticPolicy` on an llm-judgment rule emits `preset.run.failure` with `errorCode: 'PRESET-E-7'` and findings from earlier rules are still returned |
| B-5-1 | Two findings on the same file+line+ruleId+normalizedContent across two runs have the same `findingId` |
| B-5-2 | A cosmetic file-top edit (added comment line, shifts all subsequent lines by 1) does NOT change `findingId` (the line number changes but the test asserts ID stability — only `matched_content_normalized` matters via the hash) |
| B-6-1 | Rule timeout produces a synthetic finding + `preset.run.rule.timeout` log; other rules in the same preset still run |
| B-6-2 | A static-grep regex that throws (e.g. catastrophic backtracking caught by Node) emits `preset.run.rule.failure` and does not crash sibling rules |

## 7. Behaviors

### B-1 — `loadPreset` happy/sad path

- **B-1-1** Loading an existing built-in preset returns a parsed manifest with the expected `rules` count.
- **B-1-2** Loading a non-existent preset throws `PRESET-E-1`.

### B-2 — Three-layer lookup + shadow

- **B-2-1** When the same `id` exists in plugin + project + builtin, `listPresets` reports the plugin source as winner and the other layers as shadowed.
- **B-2-2** `loadPreset` for that id returns the plugin's manifest.

### B-3 — Manifest validation

- **B-3-1** Unknown frontmatter key triggers `PRESET-E-2`.
- **B-3-2** `mechanism: 'llm-judgment'` without `llmPolicy` triggers `PRESET-E-4`.

### B-4 — `runPreset` execution & error handling

- **B-4-1** A preset with 3 rules causes 3 per-rule lifecycle events.
- **B-4-2** Each finding has a matching `preset.run.rule.finding` event.
- **B-4-3** Missing `criticPolicy` on an LLM rule throws `PRESET-E-7` but does not lose findings from already-completed rules.

### B-5 — Finding ID stability

- **B-5-1** Same `(file, line, ruleId, normalizedContent)` produces same ID across runs.
- **B-5-2** Cosmetic file-top edits do not change findings' IDs (line shifts within the file).

### B-6 — Rule isolation under failure

- **B-6-1** A timed-out rule yields a synthetic P3 finding and a `preset.run.rule.timeout` log; sibling rules still execute.
- **B-6-2** A throwing mechanism (e.g. malformed regex caught at runtime) emits `preset.run.rule.failure` and does not interrupt sibling rules.

## 8. Dependencies

- **Track L (log module)** — every entry point accepts an optional `logger: TrackLogger`. Default logger created with `track: 'preset'`.
- **Protocol-1 (cross-engine reviewer)** — runtime dependency for `llm-judgment` mechanism only. P2 imports `CriticPolicy` type from P1's surface; the actual LLM dispatch is delegated. Compile-time circular dependency is avoided because `Finding` (P2-owned) is referenced by P1 but P1's `CriticPolicy` is only referenced through a function-call boundary (P2 calls P1, never the reverse).

External: `yaml`, `gray-matter`, `zod` (all already in `package.json`). No new deps.
