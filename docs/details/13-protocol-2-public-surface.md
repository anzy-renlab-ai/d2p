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
  fileFilter?: (path: string) => boolean;  // default: include all files except .git/, node_modules/
}

// CriticPolicy is imported from Protocol-1 (core/protocol/cross-engine-reviewer)
import type { CriticPolicy } from '../cross-engine-reviewer/types';

export interface RunOptions {
  logger?:       TrackLogger;
  criticPolicy?: CriticPolicy;         // REQUIRED iff manifest has any 'llm-judgment' rule
}

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

## Three-layer lookup chain

Priority (high → low):

1. **Plugin** — globbed: `${cwd}/node_modules/@zerou-preset-*/preset.md` (one preset per package). Augmented by `ZEROU_PRESET_PLUGIN_DIRS`.
2. **Project** — `${cwd}/.zerou/presets/*.md`. Override via `LoadOptions.projectDir`.
3. **Builtin** — files bundled with the npm package. Override via `LoadOptions.builtinDir` / env.

When `loadPreset(id)` finds matches at multiple layers, the highest-priority source wins; the loader emits a `preset.load.shadowed` log event and the returned `LoadedPreset.shadowedBy` lists shadowed layers. The loader never throws on shadow.

## Error codes

All thrown errors carry `error.message` starting with the code:

| Code | Trigger |
|---|---|
| `PRESET-E-1` | `loadPreset(id)`: id not found in any layer |
| `PRESET-E-2` | `loadPreset`: manifest frontmatter fails schema (unknown key, missing required, type mismatch) |
| `PRESET-E-3` | `loadPreset`: zero rules, or duplicate `ruleId` within one preset |
| `PRESET-E-4` | `loadPreset`: `llm-judgment` rule missing `llmPolicy` |
| `PRESET-E-5` | `loadPreset` / `listPresets`: plugin package has more than one `preset.md` |
| `PRESET-E-6` | `loadPreset`: malformed `static-grep` regex |
| `PRESET-E-7` | `runPreset`: missing `criticPolicy` when manifest declares any `llm-judgment` rule. Throws AFTER returning findings from rules that already completed (partial result + error) |
| `PRESET-E-8` | `runPreset`: rule timeout (>60s default, or rule-config override). NOT thrown — a synthetic `P3` finding is produced with `message: 'rule timed out'`. |

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

- **B-4-1** A preset with 3 rules (any mix of deterministic mechanisms) yields N findings (N ≥ 0) and emits 3× `preset.run.rule.start` + 3× `preset.run.rule.success` log events.
- **B-4-2** Each produced finding has a matching `preset.run.rule.finding` log event with the same `findingId` and `severity`.
- **B-4-3** `runPreset` on a manifest with any `llm-judgment` rule but called without `criticPolicy`: rejects with `PRESET-E-7`. The thrown error carries `partialFindings: Finding[]` containing findings from rules that completed before the LLM rule was reached.

### B-5 — Finding ID stability

- **B-5-1** Calling `buildFindingId({presetId:'x', ruleId:'r', file:'a.ts', line:10, evidence:'foo'})` twice produces identical `id`.
- **B-5-2** Changing only the file's *unrelated* content (e.g. line 50 changes; finding is at line 10) does not affect the finding-at-line-10's `id`. The hash includes only the matched content normalization, not the rest of the file.

### B-6 — Rule isolation under failure

- **B-6-1** A rule whose `detection.timeoutMs` is set low (e.g. 10ms) and whose mechanism's implementation deliberately sleeps longer yields a synthetic `Finding` with `severity: 'P3'`, `message: 'rule timed out'`, and a `preset.run.rule.timeout` log event. Sibling rules still produce their own findings.
- **B-6-2** A rule with a deliberately throwing `detection` config (e.g. malformed regex caught at runtime in `static-grep`) emits `preset.run.rule.failure` and does not interrupt sibling rules.

## Self-emitted log events under `track='preset'`

| Event | Level | Required fields |
|---|---|---|
| `preset.load.start` | `info` | `presetId: string`, `requestedFrom: string` |
| `preset.load.resolved` | `info` | `presetId`, `source: LookupSource`, `path: string` |
| `preset.load.shadowed` | `info` | `presetId`, `winningSource: LookupSource`, `shadowedSources: LookupSource[]` |
| `preset.load.success` | `info` | `presetId`, `version: number`, `rulesCount: number` |
| `preset.load.failure` | `error` | `presetId`, `errorCode: string` (`PRESET-E-*`), `error: string` |
| `preset.run.start` | `info` | `presetId`, `rulesCount: number` |
| `preset.run.rule.start` | `debug` | `presetId`, `ruleId`, `mechanism: PresetMechanism` |
| `preset.run.rule.finding` | `debug` | `presetId`, `ruleId`, `findingId`, `severity: Severity`, `file: string`, `line: number` |
| `preset.run.rule.success` | `info` | `presetId`, `ruleId`, `findingsCount: number`, `durationMs: number` |
| `preset.run.rule.timeout` | `warn` | `presetId`, `ruleId`, `timeoutMs: number` |
| `preset.run.rule.failure` | `error` | `presetId`, `ruleId`, `error: string` |
| `preset.run.success` | `info` | `presetId`, `findingsCount: number`, `durationMs: number` |
| `preset.run.failure` | `error` | `presetId`, `ruleId`, `errorCode: 'PRESET-E-7'` |

Child scopes used by the module: `parse`, `validate`, `mechanism.<name>` (one per `PresetMechanism`).

## What this surface does NOT promise

- It does not promise concrete file-system semantics (case-sensitivity, symlink behavior, UNC paths) — caller-side fixtures must match the target OS.
- It does not promise stable iteration order of `listPresets` results beyond "presets within one layer are alphabetical by id".
- It does not promise rate-limiting of `runPreset` against the critic engine — that is Protocol-1's responsibility (Q3 concurrency cap).
- It does not promise that the markdown body is rendered or validated — it is captured verbatim as `manifest.body`.
