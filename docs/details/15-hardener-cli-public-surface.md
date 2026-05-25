# 15 — Hardener CLI Public Surface

> Black-box contract. **Test doc authors MUST read only this file**, not the spec.

---

## Surface version

```typescript
export const HARDENER_CLI_SURFACE_VERSION = '1.0' as const;
```

## Command

```
zerou audit <path> [options]
```

### Positional

- `<path>` — Absolute or relative path to a directory on the local filesystem.

### Options

| Flag | Type | Default | Description |
|---|---|---|---|
| `--preset <id...>` | string, repeatable | (all installed) | Limit to specific preset ids. |
| `--apply` | boolean | `false` | Attempt fixes after verdicts. Refuses on dirty working tree without `--allow-dirty`. |
| `--fail-on <p1\|p2\|p3\|none>` | enum | `none` | Exit-code threshold. See "Exit codes". |
| `--key <provider=key>` | string, repeatable | none | Inline LLM key. Value is redacted from `process.argv` after parse. |
| `--allow-dirty` | boolean | `false` | Allow `--apply` on a working tree with uncommitted changes. |
| `--out <file>` | path | none | Write EvidenceBundle JSON to this file. |
| `--config <file>` | path | `~/.zerou/config.json` | Override config path. |
| `--concurrency <n>` | integer | `5` | Override critic concurrency (Protocol-1 default). |
| `--cost-cap <usd>` | number | `Infinity` | Override critic cost cap. |
| `--log-level <debug\|info\|warn\|error>` | enum | `info` (or `ZEROU_LOG_LEVEL`) | Override log level. |
| `--no-color` | boolean | `false` | Disable ANSI color in stdout. |
| `--insecure-config` | boolean | `false` | Skip the unsafe-perms check on `~/.zerou/config.json` (Unix only). See footnote.<sup>1</sup> |
| `--help` | boolean | `false` | Print help and exit 0. |
| `--version` | boolean | `false` | Print package version and exit 0. |

<sup>1</sup> **Gap B3 resolution**: `--insecure-config` on Windows is silently accepted; no warning is emitted. The unsafe-perms check it bypasses is itself a no-op on Windows (see "Permissions" below), so the flag is effectively a no-op on that platform.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Audit completed; `--fail-on` threshold not crossed. |
| `1` | Execution error (uncaught exception, engine subprocess fatal, A-E-7, A-E-8, A-E-9). |
| `2` | `--fail-on` threshold crossed — at least one `verdict: 'confirmed'` finding at or above the configured severity. |
| `3` | Configuration error (A-E-1, A-E-2, A-E-3, A-E-4, A-E-5, A-E-6). |

Only `verdict: 'confirmed'` findings count toward the `--fail-on` threshold; `'critic-unavailable'`, `'needs-context'`, and `'false-positive'` do not.

### Exit-code interaction with `--apply` (Gap B7)

The `--fail-on` threshold is computed BEFORE `--apply` is considered. Whether `--apply` actually wrote any files — and whether all proposals were skipped — does NOT affect the exit code.

**Worked example**: `zerou audit <path> --fail-on p1 --apply` on a repo that produces one confirmed P1 finding whose preset has `fix.kind = 'llm-only'` and whose `proposeFix` returns `{ verified: false, ... }` (so the proposal is skipped):

- Threshold check: one confirmed P1 → threshold crossed → exit 2.
- Apply phase: proposal skipped (`cli.apply.skip-unverified`, `bundle.apply.llmUnverifiedSkipped++`).
- **Final exit code: 2** (NOT 0, even though no fix was applied).

See `B-10-6` for the corresponding behavior contract.

## Environment variables consumed

| Var | Effect |
|---|---|
| `ZEROU_<PROVIDER>_KEY` | Per-provider LLM key. Provider is uppercased + hyphens→underscores (e.g. `ZEROU_OPENAI_COMPAT_KEY`). |
| `ZEROU_LOG_LEVEL` | Default log level. Overridden by `--log-level`. |
| `ZEROU_LOG_NULL` | Disables file log writes globally (passed through to log module). |
| `ZEROU_PRESET_PLUGIN_DIRS` | Extra plugin lookup dirs (passed through to Protocol-2). |
| `ZEROU_PRESET_BUILTIN_DIR` | Override built-in preset dir (test affordance). |

## Config file: `~/.zerou/config.json`

### Schema

```json
{
  "worker": {
    "kind": "anthropic-api" | "openai-compat" | "claude-cli" | "codex-cli" | "gemini-cli",
    "modelId": "string",
    "releaseDate": "ISO 8601 date string",
    "baseUrl": "string (openai-compat only)",
    "modelOverrides": { }
  },
  "criticPool": [
    { "kind": "...", "modelId": "...", "releaseDate": "...", "baseUrl": "..." }
  ],
  "keys": {
    "<provider>": "<key string>"
  },
  "failOn": "p1" | "p2" | "p3" | "none",
  "costCap": <number>
}
```

### Resolution & precedence

`--config <file>` overrides the default `~/.zerou/config.json` path.

**Per-key precedence** (Q8): `--key <provider>=...` flag > `ZEROU_<PROVIDER>_KEY` env > `config.keys[<provider>]`.

**Legacy fallback**: if `~/.zerou/config.json` does NOT exist AND `~/.d2p/config.json` DOES exist, the CLI reads from `~/.d2p/config.json` and emits a `cli.config.legacy-d2p-path-used` info log.

### Permissions

On Unix, the config file MUST have permission mode `0600` (or stricter — `0400`). If mode is broader, the CLI:

- Emits `cli.config.unsafe-perms` log with the offending octal mode.
- Prints to stderr: `error: ~/.zerou/config.json has unsafe permissions (<mode>). chmod 600 the file, or pass --insecure-config to override.`
- Exits with code 3.

On Windows, this check is skipped (logged at `debug` level as `cli.config.windows-permission-check-skipped`).

The `--insecure-config` flag bypasses the check on Unix.

## `--key` redaction

After Commander parses `argv`:

1. Each occurrence of `--key <provider>=<value>` in `process.argv` is overwritten in-place to `--key <provider>=[REDACTED]`. The mutation happens before any other code reads `process.argv`.
2. Stderr receives one note line: `note: --key value redacted from process listing. For repeated runs, use ZEROU_<PROVIDER>_KEY env var or ~/.zerou/config.json (chmod 600).`
3. Engine configs containing keys MUST NOT be logged with keys present — the CLI's engine-config builder strips `apiKey` / `key` fields before passing config objects to `logger.log(...)`. (Note: the log module itself does not redact; the CLI is responsible.)

## EvidenceBundle JSON output (`--out`)

When `--out <file>` is supplied, the CLI writes a JSON file matching the schema below. The same data is reflected in stdout summary (counts match exactly).

```typescript
interface EvidenceBundle {
  bundleId:     string;             // 26-char ULID
  zerouVersion: string;             // semver
  audit: {
    startedAt:   string;            // ISO 8601 with ms
    endedAt:     string;
    cwd:         string;            // absolute path on author machine
    repoSha:     string | null;     // git HEAD after auto-init
    presets:     Array<{
      id:           string;
      version:      number;
      source:       'plugin' | 'project' | 'builtin';
      resolvedPath: string;
      shadowedBy:   ('plugin' | 'project' | 'builtin')[];   // empty if no shadow; mirrors LoadedPreset.shadowedBy from P2.
    }>;
    engineConfig: {
      worker: {
        kind:        string;
        modelId:     string;        // FULL model id, e.g. 'claude-haiku-4-5-20251001'
        releaseDate: string;        // ISO date
        family:      string;
      };
      critic: {                     // null when no crossFamily critic was found
        kind:        string;
        modelId:     string;
        releaseDate: string;
        family:      string;
      } | null;
    };
  };
  findings:     VerdictedFinding[]; // shape per Protocol-1 surface
  inputFiles:   Array<{ path: string; sha256: string }>; // every file actually read; `path` is repo-relative POSIX (forward slashes), matching `Finding.file`. Absolute paths are NOT used. (Gap B8)
  summary: {
    counts: {
      confirmed:          number;
      falsePositive:      number;
      needsContext:       number;
      criticUnavailable:  number;
    };
    byPreset: Record<string, {
      confirmed:         number;
      falsePositive:     number;
      needsContext:      number;
      criticUnavailable: number;
    }>;
    failOnThreshold: 'p1' | 'p2' | 'p3' | 'none';
    exitCode:        number;
  };
  apply?: {
    requested:            boolean;
    templateApplied:      number;
    llmVerifiedApplied:   number;
    llmUnverifiedSkipped: number;
    skipNoProposal:       number;   // Gap A3: count of confirmed findings whose proposeFix returned null
  };
  version: '1.0';
}
```

## Preset selection

In MVP-0 (Phase 1 surface), hardener CLI does NOT filter presets by `PresetManifest.appliesTo`. The field is metadata only; future versions MAY add project-type detection. Today:

- When `--preset <id...>` is supplied, the CLI loads only the specified preset ids (resolved via the Protocol-2 3-layer lookup chain).
- When `--preset` is omitted, the CLI runs ALL installed presets discovered across the 3-layer lookup chain (`@zerou-preset-*` plugins, `<repo>/.zerou/presets/*.md`, built-ins).
- `PresetManifest.appliesTo` is NOT consulted as a filter in either path. A preset whose `appliesTo: ['cli-tool']` runs against a SaaS-web fixture without skipping — it is the preset author's responsibility to write rules whose `mechanism` config (e.g. `static-grep filePattern`) restricts where they apply.

This pins the consumer side of the Protocol-2 advisory note that `appliesTo` consumption "happens upstream". In Phase 1, upstream (this CLI) explicitly does NOT consume it.

## Stdout report

Six sections in fixed order: header, preset list (with shadow warnings), findings (grouped by severity then preset, colorized unless `--no-color`), summary, apply summary (if `--apply` used), exit line.

For each preset that produced ≥1 finding, the preset's `manifest.body` (the markdown body after the frontmatter `---` divider, as captured by Protocol-2 in `PresetManifest.body`) is rendered verbatim as a "Remediation guidance" subsection above that preset's findings group. Presets with zero findings do NOT have their `body` rendered. This is the documented consumer of `PresetManifest.body` referenced by the Protocol-2 surface.

### Summary section (Q11 micro)

Always present. Format:

```
Of <total> findings: <confirmed> confirmed / <falsePositive> false-positive / <needsContext> needs-context / <criticUnavailable> critic-unavailable
```

When `criticUnavailable > 0`, an extra line follows:

```
configure a second engine (different family from <workerFamily>) to verdict the remaining <criticUnavailable>.
```

**Gap B1 resolution** — the `<workerFamily>` placeholder is the **family** (the return value of `engineFamily(workerConfig)`, e.g. `anthropic`, `openai`, `google`, or a hostname for `openai-compat`), NOT the raw `EngineConfig.kind` string (e.g. `anthropic-api`). The nudge instructs the user to configure an engine of a *different family*; the family name is what they must compare against.

**Gap B9 — pinned regexes**. Tests assert against these exact patterns:

- Summary line:

  ```
  /^Of (\d+) findings: (\d+) confirmed \/ (\d+) false-positive \/ (\d+) needs-context \/ (\d+) critic-unavailable$/
  ```

- Nudge line (only present when `criticUnavailable > 0`):

  ```
  /^configure a second engine \(different family from ([a-z0-9.:-]+)\) to verdict the remaining (\d+)\.$/m
  ```

  Capture group 1 is the worker family string; the character class `[a-z0-9.:-]` covers canonical family names (`anthropic`, `openai`, `google`) and `openai-compat` hostnames (e.g. `api.deepseek.com`).

### `summary.byPreset` semantics (Gap A4 / B-10-5)

`bundle.summary.byPreset` is keyed by `presetId`. It contains exactly one entry per preset that produced **any** finding during the run (presets that produced zero findings do NOT appear). For each present preset, the four counts (`confirmed`, `falsePositive`, `needsContext`, `criticUnavailable`) sum across all keys to the corresponding top-level `summary.counts` value.

## Error codes

| Code | Trigger | Exit |
|---|---|---|
| `A-E-1` | `<path>` does not exist OR exists but is not a directory (Gap B4) | 3 |
| `A-E-2` | `--preset <id>` not in 3-layer lookup | 3 |
| `A-E-3` | Config file invalid (zod validation failure) | 3 |
| `A-E-4` | Config file unsafe perms (Unix) and no `--insecure-config` | 3 |
| `A-E-5` | `--apply` + dirty working tree without `--allow-dirty` | 3 |
| `A-E-6` | Worker engine cannot be built (no key, invalid kind) | 3 |
| `A-E-7` | A preset's `runPreset` raised `PRESET-E-7` — **defensive only** (Gap B6) | 1 |
| `A-E-8` | Uncaught exception escaping main — **defensive catch-all** (Gap B5) | 1 |
| `A-E-9` | `--out <file>` cannot be written | 1 |

**Gap B4 (A-E-1 clarification)**: `<path>` MUST be a directory. A path that exists but is a regular file is treated as A-E-1 (`cli.path.missing`). No distinct event is emitted for "is a file".

**Gap B6 (A-E-7 defensive-only)**: The CLI always builds and passes a `criticPolicy` to `runPreset` (Protocol-1's `critic.policy-selected` event under `track='critic'` is emitted unconditionally as a result). A-E-7 therefore CANNOT fire under normal flow. If it does, treat it as an internal invariant violation; the CLI rethrows as `cli.fatal` (A-E-8) and exits 1. Tests SHOULD NOT attempt to construct a fixture that fires A-E-7 through the public CLI surface.

**Gap B5 (A-E-8 untestable)**: `A-E-8` / `cli.fatal` is a defensive catch-all for uncaught exceptions. By definition it covers situations the public surface does not promise will happen, so it is **not testable from the public surface**. Tests SHOULD NOT assert on `cli.fatal`. Implementations MAY expose internal hooks for exercising this path; those hooks are NOT part of the public surface.

## Behavior contract

### Testing convention (Gap B2)

Tests that drive the CLI via `runCli` (or equivalent harness) SHOULD use **real** `EngineConfig.kind` values — `claude-cli`, `codex-cli`, `gemini-cli`, `anthropic-api`, `openai-compat` — and mock at the `core/engines/factory.createEngine` layer (e.g. with a vitest module mock). This ensures the family classification (`engineFamily()`) returns production values during tests and that cross-family critic selection behaves identically to production.

Tests SHOULD NOT invent placeholder kinds like `mock-anthropic`, `mock-openai`, or any other `mock-*` string. Such kinds are not in the Protocol-1 family taxonomy and will be classified as unknown / unrecognized families, producing test behavior that diverges from production. The "mock" lives at the factory layer, not at the engine-kind layer.

### B-1 — Repo prep (Q12)

- **B-1-1** `zerou audit <non-git-fixture>` → after run, `.git/` exists in fixture, log includes `cli.repo.auto-init`.
- **B-1-2** `zerou audit <git-fixture>` → log includes `cli.repo.existing-git` with `head` populated; no new commits.
- **B-1-3** `zerou audit <dirty-git-fixture> --apply` → exit 3, log includes `cli.repo.dirty`, fixture files unchanged.
- **B-1-4** `zerou audit <dirty-git-fixture> --apply --allow-dirty` → does NOT emit `cli.repo.dirty`, proceeds with apply attempts.

### B-2 — Argument / preset existence

- **B-2-1** `zerou audit ./does-not-exist` → exit 3, log `cli.path.missing`.
- **B-2-2** `zerou audit <fixture> --preset does-not-exist` → exit 3, log `cli.preset.requested-missing { requestedId: 'does-not-exist' }`.

### B-3 — Three-layer preset shadow warning (Q2 micro)

- **B-3-1** A fixture where the same id `X` exists at the plugin and project layers → stdout contains a line matching `/warn: preset X overridden by plugin/`, log includes `cli.preset.shadow-warn { presetId: 'X', winningSource: 'plugin', shadowedSources: ['project'] }`.

### B-4 — Critic policy & summary (Q11)

- **B-4-1** Fixture with cross-family critic configured → log `critic.policy-selected { crossFamily: true }` under `track='critic'`, audit.summary counts show some non-`critic-unavailable` verdicts (mocked critic returns mix).
- **B-4-2** Fixture with single-engine config (no critic pool) → log `critic.policy-selected { crossFamily: false, reason: 'no-critic-configured' }` under `track='critic'`, summary `criticUnavailable === total findings`, stdout summary contains "configure a second engine".

### B-5 — Exit-code threshold (Q9)

- **B-5-1** `--fail-on p1` + a fixture+critic that yields ≥1 confirmed P1 → exit 2.
- **B-5-2** `--fail-on p1` + a fixture+critic that yields only confirmed P2 and P3 (no P1 confirmed) → exit 0.
- **B-5-3** `--fail-on none` (or omitted) → exit 0 regardless of findings.

### B-6 — BYO-key security (Q8 micro)

- **B-6-1** Invoking with `--key openai=sk-test` → after parse, inspecting `process.argv` shows the entry as `--key openai=[REDACTED]`; stderr contains the note about redaction.
- **B-6-2** On a Unix-equivalent test (or simulated stat mode), config file with mode `0644` and no `--insecure-config` → log `cli.config.unsafe-perms { mode: '0644' }`, exit 3.

### B-7 — EvidenceBundle output (Q5)

- **B-7-1** `--out report.json` writes parseable JSON whose `summary.counts.*` numbers match the stdout summary numbers byte-for-byte.
- **B-7-2** Bundle's `audit.engineConfig.worker.modelId` is the FULL model id string (not a family-name like `'anthropic'`), and `releaseDate` is an ISO date.
- **B-7-3** Bundle's `inputFiles[]` contains an entry for every file path actually read during the audit (test fixture has exactly N readable files; bundle has N entries).

### B-8 — `--apply` semantics (Q4)

- **B-8-1** A confirmed finding whose preset declares `fix.kind = 'template'` → after `--apply`, working tree shows the template's intended modification, log includes `cli.apply.template { findingId }`.
- **B-8-2** A confirmed finding whose preset declares `fix.kind = 'llm-only'` and whose `proposeFix` returns `{verified: false, ...}` → working tree is UNCHANGED for that finding, log includes `cli.apply.skip-unverified { findingId }`, bundle's `apply.llmUnverifiedSkipped > 0`.

### B-9 — Secret leak prevention (Q8 micro)

- **B-9-1** Searching all log files produced by a `zerou audit --key openai=sk-secret-test ...` run yields ZERO occurrences of the literal substring `sk-secret-test`.

### B-10 — Config resolution, counters, and threshold edge cases (Gaps A1–A4, B7)

- **B-10-1** (Gap A1) Legacy `~/.d2p/` fallback: when `~/.zerou/config.json` does NOT exist AND `~/.d2p/config.json` DOES exist, the CLI reads from `~/.d2p/config.json` and emits `cli.config.legacy-d2p-path-used { fallbackPath: '<absolute path to ~/.d2p/config.json>' }` at `info` level. The run proceeds normally using the legacy file.
- **B-10-2** (Gap A1) `~/.zerou/` precedence: when BOTH `~/.zerou/config.json` AND `~/.d2p/config.json` exist, the CLI reads ONLY `~/.zerou/config.json`. NO `cli.config.legacy-d2p-path-used` event is emitted.
- **B-10-3** (Gap A2) Invalid config: when the resolved config file fails zod validation, the CLI emits `cli.config.invalid { errorCode: 'A-E-3', issues: '<stringified zod issues>' }` at `error` level and exits with code 3 (A-E-3).
- **B-10-4** (Gap A3) Skip-no-proposal counter: when `--apply` is set and a confirmed finding's `proposeFix` returns `null` (no proposal at all — distinct from `{verified: false}`), the CLI emits `cli.apply.skip-no-proposal { findingId }` at `warn` level AND `bundle.apply.skipNoProposal` is incremented by 1. Working tree is unchanged for that finding.
- **B-10-5** (Gap A4) Per-preset breakdown: `bundle.summary.byPreset` has exactly one key per preset that produced any finding (presets with zero findings are absent). For every preset key, summing the four counts across all keys equals the corresponding `bundle.summary.counts.*` top-level value (per-preset counts sum to top-level counts exactly).
- **B-10-6** (Gap B7) Threshold computed before apply: with `--fail-on p1 --apply` against a fixture that yields ≥1 confirmed P1 finding whose only fix is `llm-only` with `verified: false` (so every proposal is skipped), the CLI exits with code 2. The exit code is determined by the confirmed-P1 count BEFORE the apply phase runs; the fact that all proposals were skipped does NOT downgrade the exit to 0.

## Logging Contract

Hardener CLI creates one root logger `createTrackLogger('cli')` at startup; its `trace` (a fresh ULID) becomes the audit's `trace_id` and is shared across every event the CLI emits under `track='cli'` and `track='audit'`. The bundle's `audit.startedAt` ULID equals the CLI logger's `trace`.

When CLI invokes Protocol-1's `reviewBatch` / `reviewFinding` / `proposeFix`, it passes its CLI logger via `opts.logger`. Protocol-1 internally creates its own `track='critic'` logger via `createTrackLogger('critic', { parentTrace: cliLogger.trace })` — so all `critic.*` events land under `track='critic'` while sharing the CLI's `trace`. Filtering log entries by `track` separates concerns; filtering by `trace` reconstructs the full causal chain of one audit run.

Similarly, Protocol-2 calls (`loadPreset`, `listPresets`, `runPreset`) receive the CLI logger and internally emit under `track='preset'` with `parentTrace` plumbed through.

**Policy-selection event ownership (F9 — `cli.policy` removed)**: Policy selection is logged by Protocol-1 as `critic.policy-selected` under `track='critic'`. The CLI does NOT emit a separate `cli.policy` event. Log consumers summarizing audits should read `critic.policy-selected` (per Protocol-1 surface §"Self-emitted log events under `track='critic'`") rather than expecting a CLI-side duplicate.

**Secret redaction**: per the Protocol-1 redaction invariant, no `critic.*` event payload contains `apiKey` / `token` / `authorization` / `bearer` fields at any nesting depth. The CLI also strips these fields from any engine-config payloads it logs under `cli.*` events (e.g. `cli.engine.worker-build-failed`).

## Self-emitted log events

### Under `track='cli'`

| Event | Level | Required fields |
|---|---|---|
| `cli.audit.start` | `info` | `path`, `presets`, `apply: boolean`, `failOn: string` |
| `cli.audit.end` | `info` | `findingsCount`, `exitCode`, `durationMs` |
| `cli.path.missing` | `error` | `path` |
| `cli.preset.requested-missing` | `error` | `requestedId` |
| `cli.config.invalid` | `error` | `errorCode: 'A-E-3'`, `issues: string` |
| `cli.config.unsafe-perms` | `error` | `path`, `mode: string` |
| `cli.config.legacy-d2p-path-used` | `info` | `fallbackPath: string` |
| `cli.config.windows-permission-check-skipped` | `debug` | (none) |
| `cli.repo.auto-init` | `info` | `cwd` |
| `cli.repo.existing-git` | `info` | `cwd`, `head` |
| `cli.repo.dirty` | `error` | `cwd` |
| `cli.engine.worker-build-failed` | `error` | `kind`, `error` |
| `cli.preset.listed` | `info` | `count: number` |
| `cli.preset.shadow-warn` | `warn` | `presetId`, `winningSource: string`, `shadowedSources: string[]` |
| `cli.preset.run-failed` | `error` | `presetId`, `errorCode` |
| `cli.apply.template` | `info` | `findingId` |
| `cli.apply.llm-verified` | `info` | `findingId` |
| `cli.apply.skip-unverified` | `warn` | `findingId` |
| `cli.apply.skip-no-proposal` | `warn` | `findingId` |
| `cli.bundle.write-success` | `info` | `path`, `bytes` |
| `cli.bundle.write-failed` | `error` | `path`, `error` |
| `cli.fatal` | `error` | `error`, `stack` |

Child scopes used: `config`, `repo`, `scan`, `verdict`, `apply`, `bundle`, `report`.

### Under `track='audit'`

| Event | Level | Required fields |
|---|---|---|
| `audit.summary` | `info` | full `EvidenceBundle.summary` contents (counts, byPreset, failOnThreshold, exitCode) |

## What this surface does NOT promise

- It does not promise specific stdout colorization beyond "P1 red, P2 yellow, P3 dim; suppressed under `--no-color`". Test cases SHOULD NOT depend on exact ANSI sequences.
- It does not promise exit-code semantics for `--help` / `--version` beyond `0`.
- It does not promise the temp-clone strategy used by `proposeFix` (that's a Protocol-1 internal).
- It does not promise the order of preset execution beyond "stable across runs given the same lookup chain"; specifically NOT alphabetical, NOT severity-ordered, NOT topo-sorted by `dependsOn` (advisory only).
- It does not promise that `audit.summary` event timing is strictly after `cli.audit.end` — both are emitted just before exit but order across separate loggers is not specified.
