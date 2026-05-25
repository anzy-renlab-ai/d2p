# 15 — Hardener CLI Spec (Track A)

> SPEC-SPLIT artifact, Phase 1. Sibling files:
> [public-surface](./15-hardener-cli-public-surface.md) · [tests](./15-hardener-cli-tests.md) · [comparison-report](./15-hardener-cli-comparison-report.md)

---

## 1. Goal

`zerou audit <path>` — a single-invocation CLI that runs preset checks against a local repo, routes findings through a cross-engine critic, and emits a human report (stdout) plus an EvidenceBundle JSON (`--out`). No daemon required.

## 2. Non-goals

1. **No daemon dependency** — `zerou audit` runs as a standalone CLI process. It does not require `zerou start` or any background service. (Q6 decision.)
2. **No session resume / SQLite state** — each invocation is fresh. Re-running on the same repo is the supported "remember what I found last time" path (via EvidenceBundle merge), not a session reopen.
3. **No SSE / web UI / browser open** — output is stdout text + optional `--out <path>.json`. There is no `zerou audit --watch` mode.
4. **No automatic commit / push** — `--apply` writes uncommitted changes to the working tree. The user inspects with `git diff` and decides. Hardener CLI never invokes `git commit` or `git push`.
5. **No remote repo fetch** — `<path>` must be a local path. No `zerou audit https://github.com/...`. Use `git clone` first.
6. **No multi-repo / monorepo selective scan** — `zerou audit <path>` scans everything under `<path>` (modulo `fileFilter` defaults). A monorepo-aware sub-tree mode is deferred.
7. **No interactive prompts** — the CLI never asks "y/n". Every required input is a flag, env var, or config file. (CI-friendly default.)

## 3. Public surface

Authoritative shape lives in [15-hardener-cli-public-surface.md](./15-hardener-cli-public-surface.md). Summary:

- Command: `zerou audit <path>` with flags `--preset`, `--apply`, `--fail-on`, `--key`, `--allow-dirty`, `--out`, `--config`, `--no-color`, `--log-level`, `--concurrency`, `--cost-cap`.
- Exit code semantics keyed off `--fail-on`.
- Config lookup chain (`--key` flag > `ZEROU_<PROVIDER>_KEY` env > `~/.zerou/config.json`).
- `~/.zerou/config.json` JSON schema.
- EvidenceBundle JSON skeleton (Phase 1 subset; full P3 spec in Phase 3).
- Top-level logger creation (`track='cli'`) plus child scopes for major phases.

## 4. Internal design

### 4.1 Command surface

```
zerou audit <path> [options]

Required:
  <path>                            Absolute or relative path to a local directory.

Options (Phase 1):
  --preset <id...>                  Specific preset(s) to run. Repeatable. Default: all installed presets that match repo type.
  --apply                           After review, attempt fixes (template > LLM proposal w/ verify).
                                    Refuses when working tree is dirty unless --allow-dirty also given.
  --fail-on <p1|p2|p3|none>         Exit code threshold (see §4.7). Default: none.
  --key <provider>=<key>            Inline LLM key (e.g. --key openai=sk-...). Repeatable.
                                    Value is redacted from process argv after parse (see §4.9).
  --allow-dirty                     Allow --apply on a working tree with uncommitted changes.
  --out <file>                      Write EvidenceBundle JSON to this path.
  --config <file>                   Override ~/.zerou/config.json path.
  --concurrency <n>                 Override default critic concurrency 5 (Q3).
  --cost-cap <usd>                  Override default cost cap.
  --log-level <debug|info|warn|error>
                                    Override ZEROU_LOG_LEVEL.
  --no-color                        Disable ANSI color in stdout.
  --help                            Print help & exit 0.
  --version                         Print version & exit 0.
```

### 4.2 Top-level flow

```
zerou audit(path, opts):

  # 1. Argument & config resolution
  cwd = resolveAbsolute(path)
  config = loadConfig(opts.config ?? '~/.zerou/config.json')
  engineConfig = resolveEngineConfig(opts, config, process.env)     # see §4.8
  failOn = opts.failOn ?? config.failOn ?? 'none'

  logger = createTrackLogger('cli', { minLevel: opts.logLevel })
  logger.log('info', 'cli.audit.start', { path: cwd, presets: opts.preset, apply: !!opts.apply })

  # 2. Repo prep (Q12)
  ensureRepo(cwd, logger)                                            # auto git init if non-git
  if opts.apply and isDirty(cwd) and not opts.allowDirty:
    logger.log('error', 'cli.repo.dirty', {})
    print 'uncommitted changes detected; commit/stash or use --allow-dirty'
    exit 3                                                            # config error class

  # 3. Preset resolution
  presets = listPresets({cwd}).filter(matchPresetOptOrAll(opts.preset))
  for each shadowed preset, print "warn: preset <id> overridden by <source>"

  # 4. Run presets → Findings
  ctx = { cwd, repoSha: gitHead(cwd) }
  findings = []
  for preset in presets:
    findings.push(...await runPreset(preset.manifest, ctx, { logger: logger.child('scan'), criticPolicy: <forwarded> }))

  # 5. Cross-engine review
  policy = pickCriticEngine(engineConfig.worker, engineConfig.criticPool)
  logger.log('info', 'cli.policy', { workerFamily, criticFamily, crossFamily })
  verdicted = await reviewBatch(findings, ctx, policy, {
    logger: logger.child('verdict'),
    concurrency: opts.concurrency ?? 5,
    costCap: opts.costCap ?? config.costCap ?? Infinity,
  })

  # 6. Optional --apply
  if opts.apply:
    appliedSummary = await applyFixes(verdicted, ctx, policy, { logger: logger.child('apply') })

  # 7. Bundle assembly + output
  bundle = buildEvidenceBundle({ verdicted, presets, engineConfig, ctx, failOn })
  if opts.out:
    writeFileSync(opts.out, JSON.stringify(bundle, null, 2))

  # 8. Stdout summary (Q11 micro)
  printSummary(bundle, opts)

  # 9. Exit code (Q9 + Q9 micro)
  exit = computeExitCode(bundle.summary, failOn)
  logger.log('info', 'cli.audit.end', { findings: bundle.findings.length, exitCode: exit })
  process.exit(exit)
```

### 4.3 Repo prep (`ensureRepo` — Q12)

```
ensureRepo(cwd, logger):
  if not exists(cwd):
    throw 'A-E-1: path does not exist: ' + cwd
  if not exists(cwd + '/.git'):
    git init at cwd
    git add -A
    git commit -m 'zerou: initial commit (auto)'
    logger.log('info', 'cli.repo.auto-init', { cwd })
  else:
    logger.log('info', 'cli.repo.existing-git', { cwd, head: gitHead(cwd) })

isDirty(cwd):
  return `git status --porcelain` (in cwd) returns non-empty stdout
```

### 4.4 Preset selection

- `--preset <id>` repeated: union of explicitly named presets. Each id must resolve via `loadPreset`; otherwise `A-E-2: preset <id> not found`.
- No `--preset` flag: `listPresets({cwd})` returns all installed across the 3-layer lookup. The CLI runs all of them (the appliesTo / project-type filter is per-preset, not CLI-level).
- Shadowed presets: the warning `warn: preset <id> overridden by <higher-priority-source>` is printed once per shadowed id (Q2 micro). The chosen source is the higher-priority one (P2 §4.1).

### 4.5 Fix application (Q4 + Q4 micro)

```
applyFixes(verdicted, ctx, policy, opts):
  summary = { template: 0, llmVerified: 0, llmUnverifiedSkipped: 0 }
  for vf of verdicted where vf.verdict === 'confirmed':
    if vf.fixAvailable === 'template':
      apply preset's template codemod for vf.ruleId
      summary.template += 1
    elif vf.fixAvailable === 'llm-only':
      proposal = await proposeFix(vf, ctx, policy, { logger: opts.logger })
      if proposal === null:
        log 'cli.apply.skip-no-proposal' { findingId: vf.id }
        continue
      if proposal.verified:
        write proposal.patch to working tree
        summary.llmVerified += 1
        log 'cli.apply.llm-verified' { findingId: vf.id }
      else:
        # Q4 micro: refuse to apply unverified proposals
        log 'cli.apply.skip-unverified' { findingId: vf.id }
        summary.llmUnverifiedSkipped += 1
        print 'skipped finding ' + vf.id + ': LLM proposal could not self-verify'
  return summary
```

The `'LLM (unverified)'` banner is printed inline in `printSummary` when `summary.llmUnverifiedSkipped > 0`.

### 4.6 EvidenceBundle assembly

Phase 1 skeleton (full P3 spec is Phase 3):

```typescript
interface EvidenceBundle {
  bundleId:     string;             // ULID
  zerouVersion: string;             // package.json version
  audit: {
    startedAt:   string;            // ISO 8601
    endedAt:     string;
    cwd:         string;
    repoSha:     string | null;
    presets:     Array<{ id: string; version: number; source: 'plugin'|'project'|'builtin'; resolvedPath: string }>;
    engineConfig: {
      worker:    EngineMetaSnapshot;
      critic:    EngineMetaSnapshot | null;        // null when no crossFamily critic
    };
  };
  findings:     VerdictedFinding[];
  inputFiles:   Array<{ path: string; sha256: string }>;   // every file actually read by a check
  summary: {
    counts: {
      confirmed:          number;
      falsePositive:      number;
      needsContext:       number;
      criticUnavailable:  number;
    };
    byPreset: Record<string, { confirmed: number; falsePositive: number; needsContext: number; criticUnavailable: number }>;
    failOnThreshold: 'p1' | 'p2' | 'p3' | 'none';
    exitCode:        number;
  };
  apply?: {
    requested:           boolean;
    templateApplied:     number;
    llmVerifiedApplied:  number;
    llmUnverifiedSkipped: number;
  };
  version: '1.0';
}

interface EngineMetaSnapshot {
  kind:        string;
  modelId:     string;            // FULL model id, per Q5 micro
  releaseDate: string;            // ISO date
  family:      string;
}
```

`inputFiles` is built by instrumenting the `fileFilter` / `readFile` calls each preset makes during `runPreset`. The CLI wraps `ctx.readFile` to record `(path, sha256)` per file actually read. (Q5: "auditable" reproducibility.)

### 4.7 Exit codes (Q9)

```
computeExitCode(summary, failOn):
  if execError happened earlier: return 1
  if configError happened earlier: return 3
  if failOn === 'none': return 0
  if failOn === 'p3' and counts.{p3|p2|p1}.confirmed > 0: return 2
  if failOn === 'p2' and counts.{p2|p1}.confirmed > 0: return 2
  if failOn === 'p1' and counts.p1.confirmed > 0: return 2
  return 0
```

Exit code table:

| Code | Meaning |
|---|---|
| 0 | Audit completed; `--fail-on` threshold not crossed |
| 1 | Execution error (unexpected crash, uncaught exception, engine subprocess fatal) |
| 2 | Threshold crossed (`--fail-on` configured and findings of that severity exist with `verdict: 'confirmed'`) |
| 3 | Configuration error (bad flag, missing key when LLM rule requires one, dirty working tree without `--allow-dirty`, etc.) |

`verdict: 'critic-unavailable'` and `'needs-context'` findings do NOT count toward the threshold — only `'confirmed'`. Rationale: a critic-unavailable finding hasn't been actually verified.

### 4.8 Engine config resolution (Q8)

```
resolveEngineConfig(opts, config, env):
  # Worker is the engine running detection. Critic pool is what's available for second opinions.
  workerKind = opts.workerKind ?? config.worker.kind ?? 'anthropic-api'
  workerKey  = pickKey(workerKind, opts.key, env, config)
  workerCfg  = buildEngineConfig(workerKind, workerKey, opts, config)

  criticPool = []
  for kind in (config.criticPool ?? []):
    key = pickKey(kind, opts.key, env, config)
    if key: criticPool.push(buildEngineConfig(kind, key, opts, config))

  return { worker: workerCfg, criticPool }

pickKey(provider, optKeys, env, config):
  # Q8 priority: flag > env > config.
  if optKeys[provider]: return optKeys[provider]
  envName = 'ZEROU_' + provider.toUpperCase().replaceAll('-', '_') + '_KEY'
  if env[envName]: return env[envName]
  if config.keys[provider]: return config.keys[provider]
  return null
```

### 4.9 BYO-key security (Q8 micro)

Two enforcements:

1. **`~/.zerou/config.json` chmod 600**:
   - On Unix: any read of the config file by the CLI MUST verify `(stat.mode & 0o077) === 0`. If broader than `600`, the CLI prints a warning AND refuses to start unless `--insecure-config` is passed.
   - On Windows: the equivalent check is skipped with a debug-level log entry `cli.config.windows-permission-check-skipped`. Windows ACLs are not validated in v0.2.
   - On *creating* the file (Phase 3 hardener `init` subcommand), `chmod 600` is set explicitly. Phase 1 spec only requires read-side enforcement.

2. **`--key` value redaction**:
   - Immediately after Commander parses `argv`, the CLI overwrites the corresponding `process.argv` entry with `--key <provider>=[REDACTED]`.
   - All log entries that reference engine configs MUST omit `apiKey` / `key` fields. The logger module's `log()` does not redact; the CLI's engine-config builder strips these before logging.
   - When a user passes `--key`, the CLI also prints to stderr: `note: --key value redacted from process listing. For repeated runs, use ZEROU_<PROVIDER>_KEY env var or ~/.zerou/config.json (chmod 600).`

### 4.10 `~/.zerou/config.json` schema

```json
{
  "$schema": "https://zerou.example/schema/config-v1.json",
  "worker": {
    "kind": "anthropic-api" | "openai-compat" | "claude-cli" | "codex-cli" | "gemini-cli",
    "modelId": "claude-haiku-4-5-20251001",
    "releaseDate": "2025-10-01",
    "baseUrl": "...",                 // openai-compat only
    "modelOverrides": { ... }         // optional
  },
  "criticPool": [
    { "kind": "...", "modelId": "...", "releaseDate": "...", "baseUrl": "..." }
  ],
  "keys": {
    "anthropic-api": "sk-ant-...",
    "openai-compat": "sk-...",
    "gemini-cli": "AI..."
  },
  "failOn": "p1" | "p2" | "p3" | "none",
  "costCap": 5.00
}
```

Strict validation via zod; unknown fields cause `A-E-3: invalid config: <issue>`. Missing required `worker.kind` defaults to `'anthropic-api'`.

Migration: if the legacy `~/.d2p/config.json` exists and `~/.zerou/config.json` does NOT, the CLI reads from the legacy path and logs `cli.config.legacy-d2p-path-used { fallbackPath }`. Phase 3 may add an opt-in migrator; Phase 1 just falls back.

### 4.11 Stdout report format

Sections in order:

1. **Header** — `zerou audit <cwd>` + version + timestamp + engine summary (worker model id + critic model id or `(none)`).
2. **Preset list** — one line per preset run, with shadow warnings inline.
3. **Findings (grouped by severity, then preset)** — colorized (P1 red, P2 yellow, P3 dim); each finding shows `id`, `file:line`, `message`, `verdict`, and `reasoning` (truncated to 1 line).
4. **Summary block** (Q11 micro) — `Of <total> findings: <confirmed> confirmed / <falsePositive> false-positive / <needsContext> needs-context / <criticUnavailable> critic-unavailable`. When `criticUnavailable > 0`, append on a new line: `configure a second engine (different family from <workerKind>) to verdict the remaining <N>.`.
5. **Apply summary** (only if `--apply` used) — counts of template / llm-verified / llm-unverified-skipped.
6. **Exit-line** — `exit code: <n>` (matches `process.exit`).

## 5. Failure modes

| Code | Condition | Exit | Behavior |
|---|---|---|---|
| `A-E-1` | `<path>` does not exist | 3 | Prints error message; logs `cli.path.missing`. |
| `A-E-2` | `--preset <id>` not found | 3 | Prints error message; logs `cli.preset.requested-missing`. |
| `A-E-3` | Config file invalid | 3 | Prints zod issue list; logs `cli.config.invalid`. |
| `A-E-4` | Config file has unsafe perms on Unix and no `--insecure-config` | 3 | Prints warning; refuses to start; logs `cli.config.unsafe-perms`. |
| `A-E-5` | `--apply` requested but working tree dirty and no `--allow-dirty` | 3 | Prints message; refuses; logs `cli.repo.dirty`. |
| `A-E-6` | Worker engine cannot be constructed (missing key, invalid config) | 3 | Logs `cli.engine.worker-build-failed`. |
| `A-E-7` | Preset RUN failure that escapes (PRESET-E-7 from P2: missing criticPolicy on an llm-judgment rule) | 1 | Logs `cli.preset.run-failed`. |
| `A-E-8` | Unexpected uncaught exception | 1 | Top-level catch logs `cli.fatal { error, stack }`; exits 1. |
| `A-E-9` | `--out <file>` cannot be written | 1 | Logs `cli.bundle.write-failed`; nonzero exit. |

## 6. Logging Contract

### 6.1 Track name

Top-level CLI logger: `track: 'cli'`. Major phases use child scopes (NOT separate tracks) so a single audit's events are reconstructable from one `trace`:

| Scope | Phase |
|---|---|
| `config` | Config + engine resolution |
| `repo` | `ensureRepo` + dirty check |
| `scan` | Preset listing + `runPreset` invocation |
| `verdict` | `reviewBatch` |
| `apply` | `applyFixes` |
| `bundle` | `buildEvidenceBundle` + `--out` write |
| `report` | Stdout rendering |

The CLI also creates a separate top-level logger `track: 'audit'` whose only event is `audit.summary` written once at the end with the full counts (allows external tools to grep one track for "what was the outcome of every audit").

### 6.2 Required events

| Event name | Level | When | Required fields |
|---|---|---|---|
| `cli.audit.start` | `info` | First action after arg parse | `path`, `presets: string[] \| null`, `apply: boolean`, `failOn: string` |
| `cli.audit.end` | `info` | Last action before `process.exit` | `findingsCount: number`, `exitCode: number`, `durationMs: number` |
| `cli.path.missing` | `error` | A-E-1 | `path` |
| `cli.preset.requested-missing` | `error` | A-E-2 | `requestedId: string` |
| `cli.config.invalid` | `error` | A-E-3 | `errorCode: 'A-E-3'`, `issues: string` |
| `cli.config.unsafe-perms` | `error` | A-E-4 | `path`, `mode: string` (octal) |
| `cli.config.legacy-d2p-path-used` | `info` | Fallback to ~/.d2p/config.json | `fallbackPath` |
| `cli.config.windows-permission-check-skipped` | `debug` | Permission check skipped on Windows | (none) |
| `cli.repo.auto-init` | `info` | `ensureRepo` ran git init | `cwd` |
| `cli.repo.existing-git` | `info` | `ensureRepo` confirmed existing git | `cwd`, `head: string \| null` |
| `cli.repo.dirty` | `error` | A-E-5 | `cwd` |
| `cli.engine.worker-build-failed` | `error` | A-E-6 | `kind`, `error` |
| `cli.policy` | `info` | After `pickCriticEngine` | `workerFamily`, `criticFamily \| null`, `crossFamily: boolean`, `reason: string` |
| `cli.preset.listed` | `info` | `listPresets` returned | `count: number` |
| `cli.preset.shadow-warn` | `warn` | Shadowed preset printed | `presetId`, `winningSource`, `shadowedSources: string[]` |
| `cli.preset.run-failed` | `error` | A-E-7 | `presetId`, `errorCode` |
| `cli.apply.template` | `info` | Template fix applied | `findingId` |
| `cli.apply.llm-verified` | `info` | LLM proposal applied | `findingId` |
| `cli.apply.skip-unverified` | `warn` | LLM proposal skipped (Q4 micro) | `findingId` |
| `cli.apply.skip-no-proposal` | `warn` | proposeFix returned null | `findingId` |
| `cli.bundle.write-success` | `info` | --out written | `path`, `bytes: number` |
| `cli.bundle.write-failed` | `error` | A-E-9 | `path`, `error` |
| `cli.fatal` | `error` | A-E-8 | `error: string`, `stack: string` |
| `audit.summary` | `info` | End of run (on track='audit') | full bundle.summary contents |

### 6.3 Required child scopes

| Scope | Used by | Internal events |
|---|---|---|
| `config` | Argument + config + engine resolution | `config.start`, `config.loaded`, `config.engine-resolved` |
| `repo` | `ensureRepo` + `isDirty` | `repo.start`, `repo.auto-init` (alias of cli.repo.auto-init), `repo.existing-git`, `repo.dirty-check` |
| `scan` | Preset listing + runPreset orchestration | `scan.start`, `scan.preset-start`, `scan.preset-end`, `scan.end` |
| `verdict` | reviewBatch call | (delegated to P1's events under same trace, scoped 'verdict') |
| `apply` | applyFixes | events listed above |
| `bundle` | buildEvidenceBundle + write | `bundle.assemble-start`, `bundle.assemble-end`, `cli.bundle.write-success` |
| `report` | stdout rendering | `report.start`, `report.end` |

### 6.4 Behavior ↔ Log event reverse lookup

| Behavior ID | Log assertion |
|---|---|
| B-1-1 | `zerou audit <fixture>` on a non-git path emits `cli.repo.auto-init` with the cwd, AND the fixture afterwards contains `.git/` |
| B-1-2 | `zerou audit <fixture>` on a git repo emits `cli.repo.existing-git` with `head` populated |
| B-1-3 | `zerou audit <dirty-git-fixture> --apply` emits `cli.repo.dirty` AND exits 3 AND does NOT modify any files |
| B-1-4 | `zerou audit <dirty-git-fixture> --apply --allow-dirty` does NOT emit `cli.repo.dirty` AND proceeds |
| B-2-1 | `zerou audit ./does-not-exist` emits `cli.path.missing` AND exits 3 |
| B-2-2 | `zerou audit <fixture> --preset does-not-exist` emits `cli.preset.requested-missing` AND exits 3 |
| B-3-1 | Three-layer preset fixture where same id `X` is at plugin + project layers: stdout contains `warn: preset X overridden by plugin` AND logs include `cli.preset.shadow-warn` |
| B-4-1 | `zerou audit <fixture>` with a critic pool of different family → logs include `cli.policy { crossFamily: true }` AND `audit.summary` shows non-zero `confirmed + falsePositive + needsContext` |
| B-4-2 | `zerou audit <fixture>` with no critic in pool (single-engine) → logs include `cli.policy { crossFamily: false, reason: 'no-critic-configured' }` AND `audit.summary` shows `criticUnavailable === total` AND stdout summary contains the nudge text "configure a second engine" |
| B-5-1 | `zerou audit --fail-on p1 <fixture>` where critic-confirmed P1 finding exists → exit 2 |
| B-5-2 | `zerou audit --fail-on p1 <fixture>` where no P1 confirmed (only P2 confirmed) → exit 0 |
| B-5-3 | `zerou audit --fail-on none <fixture>` → always exit 0 regardless of findings |
| B-6-1 | `--key openai=sk-test` is replaced in `process.argv` with `[REDACTED]` after parse; stderr message about redaction appears |
| B-6-2 | Reading `~/.zerou/config.json` with mode 0644 on Unix → emits `cli.config.unsafe-perms` AND exits 3 |
| B-7-1 | `--out report.json` writes a parseable EvidenceBundle JSON whose `summary.counts` matches stdout summary numbers |
| B-7-2 | EvidenceBundle's `audit.engineConfig.worker.modelId` contains the FULL model id (e.g. `claude-haiku-4-5-20251001`), not just the family name |
| B-7-3 | EvidenceBundle's `inputFiles[]` contains an entry for every file actually read by any preset during the run |
| B-8-1 | `--apply` with a finding whose preset has a template fix → emits `cli.apply.template` AND working tree shows the codemod's change |
| B-8-2 | `--apply` with an LLM proposal that fails self-verify → emits `cli.apply.skip-unverified` AND working tree is UNCHANGED for that finding AND summary shows `llmUnverifiedSkipped > 0` |
| B-9-1 | A run that uses `--key openai=...` does NOT write the literal key string to any log file |

## 7. Behaviors

### B-1 — Repo prep (Q12)

- **B-1-1** Non-git path → auto `git init` + initial commit.
- **B-1-2** Git path → leave alone, capture HEAD.
- **B-1-3** Dirty git + `--apply` (no `--allow-dirty`) → A-E-5, exit 3, no fs changes.
- **B-1-4** Dirty git + `--apply --allow-dirty` → proceeds.

### B-2 — Argument / preset existence

- **B-2-1** Missing path → A-E-1, exit 3.
- **B-2-2** Missing requested preset → A-E-2, exit 3.

### B-3 — Three-layer preset warning (Q2 micro)

- **B-3-1** Same id at plugin + project layers → stdout warn line + `cli.preset.shadow-warn`.

### B-4 — Critic policy (Q11)

- **B-4-1** Cross-family pool → reviews happen, non-critic-unavailable verdicts dominate.
- **B-4-2** No cross-family critic → all findings carry `critic-unavailable`, summary nudges user.

### B-5 — Exit code threshold (Q9)

- **B-5-1** `--fail-on p1` + ≥1 confirmed P1 → exit 2.
- **B-5-2** `--fail-on p1` + only P2/P3 confirmed → exit 0.
- **B-5-3** `--fail-on none` → always exit 0.

### B-6 — BYO-key security (Q8 micro)

- **B-6-1** `--key` value redacted from `process.argv` post-parse; stderr note printed.
- **B-6-2** Unsafe config perms on Unix → A-E-4, exit 3.

### B-7 — EvidenceBundle output (Q5 + Q5 micro)

- **B-7-1** `--out` produces valid JSON matching stdout.
- **B-7-2** Bundle's engine snapshot contains full model id + release date.
- **B-7-3** Bundle's `inputFiles[]` enumerates every read file.

### B-8 — `--apply` (Q4)

- **B-8-1** Template fix applied for confirmed finding with `fixAvailable === 'template'`.
- **B-8-2** Unverified LLM proposal skipped (working tree unchanged for that finding).

### B-9 — Secret leak prevention (Q8 micro)

- **B-9-1** Log files do not contain raw `--key` values.

## 8. Dependencies

- **Track L (log module)** — top-level `track='cli'` plus child scopes; secondary `track='audit'` for end-of-run summary.
- **Protocol-2 (preset framework)** — `loadPreset`, `listPresets`, `runPreset`, `Finding` type.
- **Protocol-1 (cross-engine reviewer)** — `pickCriticEngine`, `reviewBatch`, `proposeFix`, `VerdictedFinding`, `CriticPolicy`.
- **`core/engines/*`** (Phase 3 target; currently `daemon/src/engines/*`) — engine factory / configs.
- **`commander`** — CLI argument parsing (already in deps).
- **`zod`** — config validation (already in deps).

The CLI is the *only* Phase-1 dev-doc track that wires all four foundational protocols together. P2/P1/L are reusable in isolation; the CLI is the wedge.

Phase 3 will add: the 3 first-vibe-coded presets (`secrets-leak`, `supabase-rls`, `authz-bola`) as plugin npm packages under `node_modules/@zerou-preset-*`. They land via P2's lookup chain; the CLI requires no changes.
