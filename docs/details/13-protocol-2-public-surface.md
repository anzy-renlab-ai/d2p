# 13 — Protocol-2 Preset Framework Public Surface

> Black-box contract. **Test doc authors MUST read only this file**, not the spec.

---

## Surface version

```typescript
export const PRESET_PROTOCOL_VERSION = '1.0' as const;
```

## Core types

```typescript
// from "core/protocol/preset/types"

export type Severity = 'P1' | 'P2' | 'P3';

export type PresetMechanism =
  | 'static-grep'
  | 'file-exists'
  | 'test-execution'
  | 'cross-file-cohesion'
  | 'llm-judgment';

export type LookupSource = 'plugin' | 'project' | 'builtin';

export interface Finding {
  id:                          string;       // <presetId>.<shortHash>
  presetId:                    string;
  ruleId:                      string;
  severity:                    Severity;
  file:                        string;       // repo-relative POSIX path
  line:                        number;       // 1-based; 0 for whole-file findings
  evidence:                    string;       // verbatim, max 2 KB, trailing "..." if truncated
  matched_content_normalized:  string;       // strip-whitespace + lowercase of evidence
  message:                     string;       // single human sentence
  remediationHint:             string | null;
  fixAvailable:                'template' | 'llm-only' | null;
  version:                     '1.0';
}

export interface PresetRule {
  ruleId:      string;
  label:       string;
  severity:    Severity;
  mechanism:   PresetMechanism;
  source:      string;                 // free-form attribution
  rationale?:  string;
  detection:   Record<string, unknown>; // mechanism-specific config
  fix?:        FixDeclaration;
  llmPolicy?:  LlmRulePolicy;          // REQUIRED iff mechanism === 'llm-judgment'
}

export interface FixDeclaration {
  kind:    'template' | 'llm-only';
  // template-specific fields when kind === 'template':
  command?: string;                    // codemod command, run with cwd = repo root
  // llm-only has no extra fields; fix is requested at apply-time
}

export interface LlmRulePolicy {
  criticEnforce: boolean;              // forwarded to Protocol-1 critic selection
  maxTokens?:    number;
}

export interface PresetManifest {
  id:         string;
  version:    number;                  // manifest schema version (current: 2)
  name:       string;
  appliesTo?: string[];                // letters from project-type taxonomy; omitted = all
  dependsOn?: string[];                // advisory only in v0.2
  rules:      PresetRule[];
  // body text from the markdown file (post-frontmatter)
  body:       string;
}

export interface LoadedPreset {
  manifest:        PresetManifest;
  source:          LookupSource;
  resolvedPath:    string;
  shadowedBy:      LookupSource[];     // empty if no shadowing
}
```

## Entry points

```typescript
// from "core/protocol/preset/loader"

export interface LoadOptions {
  cwd?:    string;                     // default: process.cwd()
  logger?: TrackLogger;                // default: createTrackLogger('preset')
  // override paths (test affordance):
  pluginDirs?:  string[];              // extra dirs to search at the plugin layer
  projectDir?:  string;                // override <cwd>/.zerou/presets
  builtinDir?:  string;                // override bundled built-in dir
}

export function loadPreset(id: string, opts?: LoadOptions): Promise<LoadedPreset>;

export function listPresets(opts?: LoadOptions): Promise<LoadedPreset[]>;
```

```typescript
// from "core/protocol/preset/runner"

export interface RunContext {
  cwd:         string;
  repoSha:     string | null;
  fileFilter?: (path: string) => boolean;  // see default exclusion list below
}

// Default fileFilter exclusion list (when RunContext.fileFilter is omitted):
//   .git/, node_modules/, .zerou/, dist/, build/, .next/, .turbo/, .nuxt/, coverage/, __pycache__/
// Path prefix match is case-sensitive on POSIX and case-insensitive on Windows.
// A custom fileFilter REPLACES this default entirely — it does not extend it.

// CriticPolicy is imported from Protocol-1 (core/protocol/cross-engine-reviewer)
import type { CriticPolicy } from '../cross-engine-reviewer/types';

export interface RunOptions {
  logger?:       TrackLogger;
  criticPolicy?: CriticPolicy;         // REQUIRED iff manifest has any 'llm-judgment' rule
}

// Testing note (CriticPolicy construction for unit tests of runPreset):
//   For unit tests of runPreset that exercise llm-judgment rules, construct a
//   CriticPolicy per Protocol-1's surface (§Core types) with a mock critic
//   engine implementing MinimalCriticEngineSurface — specifically, stub
//   `call(prompt, opts)` to return a JSON-stringified verdict object matching
//   the rule's expected schema (Protocol-1 parses JSON internally; the engine
//   only returns the raw string). The mock engine implements only the three
//   MinimalCriticEngineSurface members (`call`, `lastCallCostUsd`, `getMeta`)
//   — no real network access is required. This is the supported path for
//   positive llm-judgment test coverage of runPreset.

export function runPreset(
  manifest: PresetManifest,
  ctx:      RunContext,
  opts?:    RunOptions,
): Promise<Finding[]>;
```

```typescript
// from "core/protocol/preset/finding-id"

export function buildFindingId(input: {
  presetId: string;
  ruleId:   string;
  file:     string;
  line:     number;
  evidence: string;
}): { id: string; matched_content_normalized: string };
```

## Environment variables consumed

| Var | Type | Effect |
|---|---|---|
| `ZEROU_PRESET_PLUGIN_DIRS` | `string` (colon/semicolon-separated paths) | Extra dirs scanned at the plugin layer in addition to `${cwd}/node_modules/@zerou-preset-*`. |
| `ZEROU_PRESET_BUILTIN_DIR` | `string` (path) | Override for the bundled built-in dir; test affordance. |

## Manifest schema (v0.2 frontmatter)

```yaml
id:           <slug, required, /^[a-z][a-z0-9-]{1,63}$/>
version:      <positive integer, required, currently 2>
name:         <string, required>
appliesTo:    <string[], optional, each entry one of project-type letters>
dependsOn:    <string[], optional, preset ids — advisory only>
rules:                            # required, ≥1
  - ruleId:     <slug, required, unique within preset>
    label:      <string, required>
    severity:   <P1 | P2 | P3, required>
    mechanism:  <PresetMechanism, required>
    source:     <string, required>
    rationale:  <string, optional>
    detection:  <object, required, mechanism-specific keys>
    fix:        <FixDeclaration, optional>
    llmPolicy:  <LlmRulePolicy, optional; REQUIRED iff mechanism === 'llm-judgment'>
```

The markdown body after the `---` divider is captured into `PresetManifest.body` verbatim. It is used by hardener CLI's human report; it has no execution semantics.

### `appliesTo` and `dependsOn` semantics (v0.2)

- **`appliesTo`** is **advisory** in v0.2. `runPreset` does **not** filter rules against `appliesTo` and does **not** accept a project-type argument. Consumption of `appliesTo` happens upstream — e.g. the hardener CLI uses it when selecting which presets to load for a given project type. Tests against `runPreset` SHOULD NOT expect `appliesTo` to skip rules.
- **`dependsOn`** is **metadata only** in v0.2 and has no observable runtime effect. `loadPreset` does not validate that depended-on preset ids resolve. `runPreset` does not order, group, gate, or skip rules based on `dependsOn`. The field is reserved for v0.3+ when a dependency resolver may be introduced. Tests SHOULD NOT assert any runtime behavior derived from `dependsOn`.

### Per-mechanism `detection` config schemas (v0.2)

`PresetRule.detection` is `Record<string, unknown>` at the TypeScript level, but the runtime mechanism implementations expect the following shapes. A manifest whose `detection` does not match the corresponding shape for its `mechanism` causes `loadPreset` to reject with `PRESET-E-2`.

```typescript
type StaticGrepDetection = {
  pattern:      string;                 // RegExp source string (constructor: new RegExp(pattern, flags))
  flags?:       string;                 // standard RegExp flags, e.g. 'i', 'g', 'm', 'u'
  filePattern?: string;                 // glob limiting which files to scan; default: all files passing RunContext.fileFilter
  timeoutMs?:   number;                 // per-rule timeout; default 60_000
};

type FileExistsDetection = {
  paths:      string[];                 // repo-relative paths to check
  expect:     'present' | 'absent';     // produces a Finding when actual ≠ expect
  timeoutMs?: number;
};

type TestExecutionDetection = {
  command:         string;
  args?:           string[];
  failOn:          'exitCode' | 'stderrPattern';
  stderrPattern?:  string;              // REQUIRED when failOn === 'stderrPattern' (RegExp source string)
  timeoutMs?:      number;
};

type CrossFileCohesionDetection = {
  analyzer:    'env-vs-env-example' | 'package-json-vs-lock';
  config?:     Record<string, unknown>; // analyzer-specific
  timeoutMs?:  number;
};

type LlmJudgmentDetection = {
  prompt:       string;                 // template; supports {{file}}, {{line}}, {{evidence}} substitutions
  filePattern?: string;
  // NOTE: llmPolicy lives on PresetRule, not in detection.
};
```

## Three-layer lookup chain

Priority (high → low):

1. **Plugin** — globbed: `${cwd}/node_modules/@zerou-preset-*/preset.md` (one preset per package). Augmented by `ZEROU_PRESET_PLUGIN_DIRS`.
2. **Project** — `${cwd}/.zerou/presets/*.md`. Override via `LoadOptions.projectDir`.
3. **Builtin** — files bundled with the npm package. Override via `LoadOptions.builtinDir` / env.

When `loadPreset(id)` finds matches at multiple layers, the highest-priority source wins; the loader emits a `preset.load.shadowed` log event and the returned `LoadedPreset.shadowedBy` lists shadowed layers. The loader never throws on shadow.

**Per-id event order (pinned).** For each preset id resolved by `loadPreset` (and for each id encountered during `listPresets`), events fire in exactly this order:

```
preset.load.start
  → preset.load.shadowed     (emitted iff lower-priority layers also matched)
  → preset.load.resolved
  → preset.load.success
```

If load fails, `preset.load.failure` replaces `preset.load.success` (and `preset.load.resolved` / `preset.load.shadowed` may not fire depending on which stage failed).

## Error codes

All thrown errors carry `error.message` starting with the code:

| Code | Trigger |
|---|---|
| `PRESET-E-1` | `loadPreset(id)`: id not found in any layer |
| `PRESET-E-2` | `loadPreset`: manifest frontmatter fails schema (unknown key, missing required, type mismatch). **Also raised when the input `id` argument passed to `loadPreset` itself does not match `/^[a-z][a-z0-9-]{1,63}$/`** (validated BEFORE any layer is searched; independent of filesystem case-sensitivity). |
| `PRESET-E-3` | `loadPreset`: zero rules, or duplicate `ruleId` within one preset |
| `PRESET-E-4` | `loadPreset`: `llm-judgment` rule missing `llmPolicy` |
| `PRESET-E-5` | `loadPreset` / `listPresets`: a recursive scan of a single `@zerou-preset-*` plugin package directory finds more than one `preset.md` file (e.g. one at the package root and another in a `bundled-extras/` subdirectory). Only the `preset.md` at the package root is the canonical entry; any additional `preset.md` files at deeper paths within the same package trigger this error. This preserves the "one preset per package" promise. (Two distinct `@zerou-preset-*` packages declaring the same preset `id` is a different conflict, handled by shadow semantics, not PRESET-E-5.) |
| `PRESET-E-6` | `loadPreset`: malformed `static-grep` regex — **syntactically invalid pattern** caught at load time when the loader calls `new RegExp(pattern, flags)` and the constructor throws. Compare with B-6-2 (`preset.run.rule.failure`), which covers **runtime** regex failures on otherwise-valid patterns (e.g. catastrophic backtracking on adversarial input, per-pattern time-budget trip, unsupported engine feature). |
| `PRESET-E-7` | `runPreset`: missing `criticPolicy` when manifest declares any `llm-judgment` rule. Throws AFTER returning findings from rules that already completed (partial result + error). Dispatch model is **lazy**: the failing llm-judgment rule emits `preset.run.rule.start` before the missing-policy condition is discovered, and `preset.run.failure` follows. See "Error class exports" below for the typed subclass and `partialFindings` accessor. |
| `PRESET-E-8` | `runPreset`: rule timeout (>60s default, or rule-config override). NOT thrown — a synthetic `P3` finding is produced with `message: 'rule timed out'`. The synthetic finding goes through the normal emission path and DOES emit a `preset.run.rule.finding` event (the dedicated `preset.run.rule.timeout` event is additional, not a substitute). |

### Error class exports

```typescript
// from "core/protocol/preset/errors"

export class PresetError extends Error {
  readonly name: 'PresetError' | 'PresetMissingCriticPolicyError';
  readonly code: 'PRESET-E-1' | 'PRESET-E-2' | 'PRESET-E-3'
               | 'PRESET-E-4' | 'PRESET-E-5' | 'PRESET-E-6'
               | 'PRESET-E-7' | 'PRESET-E-8';
}

export class PresetMissingCriticPolicyError extends PresetError {
  readonly name: 'PresetMissingCriticPolicyError';
  readonly code: 'PRESET-E-7';
  readonly partialFindings: Finding[];   // findings from rules that completed before the llm rule was reached
}
```

- All `PRESET-E-1` through `PRESET-E-6` and `PRESET-E-8` throws (when they throw) use the base `PresetError` class with the matching `code`.
- `PRESET-E-7` specifically throws `PresetMissingCriticPolicyError`. Callers MAY narrow via `err instanceof PresetMissingCriticPolicyError` or via `err.name === 'PresetMissingCriticPolicyError'`. The `partialFindings` field is always a (possibly empty) array.
- `error.message` still starts with the code string in every case, preserving the simple string-prefix discrimination path.

## Finding ID contract

`Finding.id` is constructed exclusively via `buildFindingId(...)`. The helper:

1. Computes `matched_content_normalized = evidence.replace(/\s+/g, '').toLowerCase()`.
2. Computes `shortHash = sha1(\`${file}:${line}:${ruleId}:${matched_content_normalized}\`).hex().slice(0, 8)`.
3. Returns `id = \`${presetId}.${shortHash}\`` and `matched_content_normalized`.

Implications:
- Two findings with identical `(file, line, ruleId, normalizedContent)` get the same `id` across runs (cross-run dedup).
- A cosmetic line shift (e.g. user adds a comment at the top of a file, shifting all subsequent lines by 1) DOES change `line`, which DOES change the hash — BUT the spec acknowledges this limitation and the dedup contract holds only when the matched content itself is unchanged AND the absolute line position is unchanged. Cross-run stability is best-effort for line-shifted findings.

  Stability that IS guaranteed: re-running on an unchanged file (same content) yields identical IDs for the same findings. The hash design ensures cosmetic edits to *other* parts of a file (not at the top) do not affect findings in unchanged regions.

## Behavior contract

### B-1 — `loadPreset` happy/sad path

- **B-1-1** `loadPreset('cli-tool', { builtinDir: <fixture> })` returns a `LoadedPreset` with `source: 'builtin'`, `manifest.id === 'cli-tool'`, `manifest.rules.length >= 1`.
- **B-1-2** `loadPreset('does-not-exist')` rejects with an Error whose message starts with `PRESET-E-1`.

### B-2 — Three-layer lookup + shadow warning

- **B-2-1** When fixtures place id `X` at all three layers, `listPresets` returns one entry for `X` with `source: 'plugin'` and `shadowedBy: ['project', 'builtin']` (order-insensitive).
- **B-2-2** `loadPreset('X')` under the same setup returns `manifest` matching the plugin source.

### B-3 — Manifest validation

- **B-3-1** A manifest with an unknown frontmatter key (e.g. `weirdField: true`) causes `loadPreset` to reject with `PRESET-E-2`.
- **B-3-2** A manifest whose any rule has `mechanism: 'llm-judgment'` but no `llmPolicy` causes `loadPreset` to reject with `PRESET-E-4`.

### B-4 — `runPreset` execution & error isolation

- **B-4-1** A preset with 3 rules (any mix of deterministic mechanisms) yields N findings (N ≥ 0) and emits exactly 3× `preset.run.rule.start` + 3× `preset.run.rule.success` log events.
- **B-4-2** Every `Finding` in the returned array has exactly one matching `preset.run.rule.finding` log event with the same `findingId` and `severity`. This invariant holds for ALL findings — including synthetic findings produced by timeouts (B-6-1) or other failure paths that yield a `Finding`. The dedicated `preset.run.rule.timeout` / `preset.run.rule.failure` events are *additional*, never substitutes for the per-finding event.
- **B-4-3** `runPreset` on a manifest with 3 rules where exactly one rule has `mechanism: 'llm-judgment'`, called without `criticPolicy`: emits `preset.run.rule.start` for all three rules in iteration order (lazy dispatch model — the missing-policy condition is discovered when the llm rule is dispatched, not in a pre-iteration validation pass); the two non-llm rules emit `preset.run.rule.success`; the llm rule emits `preset.run.failure` (with `errorCode: 'PRESET-E-7'`). `runPreset` then rejects with a `PresetMissingCriticPolicyError` (see "Error class exports") whose `partialFindings: Finding[]` contains the findings produced by the rules that completed before the llm rule was reached.

### B-5 — Finding ID stability

- **B-5-1** Calling `buildFindingId({presetId:'x', ruleId:'r', file:'a.ts', line:10, evidence:'foo'})` twice produces identical `id`.
- **B-5-2** Changing only the file's *unrelated* content (e.g. line 50 changes; finding is at line 10) does not affect the finding-at-line-10's `id`. The hash includes only the matched content normalization, not the rest of the file.

### B-6 — Rule isolation under failure

- **B-6-1** A rule whose `detection.timeoutMs` is set low (e.g. 10ms) and whose mechanism's implementation deliberately sleeps longer yields a synthetic `Finding` with `severity: 'P3'`, `message: 'rule timed out'`, and a `preset.run.rule.timeout` log event. Sibling rules still produce their own findings. The synthetic timeout finding ALSO emits a `preset.run.rule.finding` event (the per-Finding invariant in B-4-2 holds for synthetic findings too); the timeout event is additional, not a substitute.
- **B-6-2** A rule whose `detection` config is syntactically valid at load time but whose mechanism implementation throws at runtime (e.g. a `static-grep` regex that triggers catastrophic backtracking on adversarial input and trips a per-pattern time budget, a ReDoS guard, or an unsupported regex feature on the current engine) emits `preset.run.rule.failure` and does not interrupt sibling rules. (Compare PRESET-E-6, which catches *syntactically invalid* regexes at load time via `new RegExp` throwing.)

### B-7 — Evidence truncation & empty-rule manifests

- **B-7-1** A `Finding` whose `evidence` content is ≤ 2048 bytes is preserved verbatim — `Finding.evidence` exactly equals the captured source substring with no truncation, no trailing `...`, and no other modification.
- **B-7-2** A `Finding` whose underlying evidence content exceeds 2048 bytes is truncated such that `Finding.evidence` has length exactly 2048 bytes including a trailing `...` (the final three characters are `...`; the preceding 2045 bytes are the verbatim head of the source content). `matched_content_normalized` is computed over the truncated `evidence`.
- **B-7-3** `runPreset(manifest, ctx, opts)` invoked with a manifest whose `rules: []` (empty array) returns `[]` (an empty `Finding[]`) without throwing, and emits exactly `preset.run.start { presetId, rulesCount: 0 }` followed by `preset.run.success { presetId, findingsCount: 0, durationMs }`. No `preset.run.rule.*` events fire. Note: `loadPreset` rejects zero-rule manifests via `PRESET-E-3`, so this state is reachable only by a programmatic caller that constructs a `PresetManifest` directly.

## Self-emitted log events under `track='preset'`

| Event | Level | Required fields |
|---|---|---|
| `preset.list.start` | `info` | `layersScanned: string[]` (e.g. `['plugin', 'project', 'builtin']`) |
| `preset.list.success` | `info` | `count: number` (number of distinct presets returned) |
| `preset.load.start` | `info` | `presetId: string`, `requestedFrom: string` |
| `preset.load.resolved` | `info` | `presetId`, `source: LookupSource`, `path: string` |
| `preset.load.shadowed` | `info` | `presetId`, `winningSource: LookupSource`, `shadowedSources: LookupSource[]` |
| `preset.load.success` | `info` | `presetId`, `version: number`, `rulesCount: number` |
| `preset.load.failure` | `error` | `presetId`, `errorCode: string` (`PRESET-E-*`), `error: string` |
| `preset.run.start` | `info` | `presetId`, `rulesCount: number` |
| `preset.run.rule.start` | `debug` | `presetId`, `ruleId`, `mechanism: PresetMechanism` |
| `preset.run.rule.finding` | `debug` | `presetId`, `ruleId`, `findingId`, `severity: Severity`, `file: string`, `line: number`. Emitted for EVERY Finding in the returned array — including synthetic findings produced by timeouts (B-6-1) and other failure paths that yield a Finding. |
| `preset.run.rule.success` | `info` | `presetId`, `ruleId`, `findingsCount: number`, `durationMs: number` |
| `preset.run.rule.timeout` | `warn` | `presetId`, `ruleId`, `timeoutMs: number` |
| `preset.run.rule.failure` | `error` | `presetId`, `ruleId`, `error: string` |
| `preset.run.success` | `info` | `presetId`, `findingsCount: number`, `durationMs: number` |
| `preset.run.failure` | `error` | `presetId`, `ruleId`, `errorCode: 'PRESET-E-7'` |

**`listPresets` log contract.** A call to `listPresets(opts?)` emits exactly:

1. `preset.list.start { layersScanned: string[] }` once, at the beginning.
2. For each preset id discovered, the same per-id sequence specified for `loadPreset` (`preset.load.start` → optional `preset.load.shadowed` → `preset.load.resolved` → `preset.load.success`), in id-iteration order.
3. `preset.list.success { count: number }` once, at the end.

A `loadPreset(id)` call emits only the per-id sequence (no `preset.list.*` events).

Child scopes used by the module: `parse`, `validate`, `mechanism.<name>` (one per `PresetMechanism`).

### Logging Contract

**Secret redaction invariant**: No `preset.*` log event payload may contain any of these field names at any nesting depth: `apiKey`, `token`, `authorization`, `bearer`. Callers that pass engine configs or credentials through `RunOptions` MUST strip these fields before Protocol-2 logs them. This is a hard contract — Phase-3 tests assert no such field appears anywhere under `track='preset'`.

## What this surface does NOT promise

- It does not promise concrete file-system semantics (case-sensitivity, symlink behavior, UNC paths) — caller-side fixtures must match the target OS.
- It does not promise stable iteration order of `listPresets` results beyond "presets within one layer are alphabetical by id".
- It does not promise rate-limiting of `runPreset` against the critic engine — that is Protocol-1's responsibility (Q3 concurrency cap).
- It does not promise that the markdown body is rendered or validated — it is captured verbatim as `manifest.body`.
