# 15 — Hardener CLI Test Plan

> Black-box test plan derived from `15-hardener-cli-public-surface.md` only.
> Authoring rules: this doc was written without reading the spec or any source
> under `daemon/`, `cli/`, or `core/`. Only the four surface docs listed at the
> bottom were consulted.

---

## 1. Test framework assumption

**Runner**: `vitest` (`npm test -- hardener-cli`).

**Two execution modes**, picked per test:

1. **Subprocess mode** — spawn the built binary as a child process
   (`zerou audit <argv>`), capture `stdout`, `stderr`, and `exitCode`. Used for
   any assertion that depends on `process.argv` redaction, real exit codes,
   on-disk log files, or stdout colorization presence/absence. Each subprocess
   run lives in a tmpdir whose `.zerou/logs/` is read directly after the run
   completes to verify on-disk JSONL entries.

2. **In-process mode** — call an exported `main(argv: string[]): Promise<number>`
   from `cli/zerou-audit/main.ts` (assumed; the surface only promises the
   external command shape, but tests need finer hooks). Wrapped in
   `captureLogsFor({ track: 'cli' }, () => main(argv))` to assert log entries
   structurally without parsing JSONL off disk. Used for the bulk of B-2 / B-4
   / B-7 / B-8 assertions where what matters is *which event fired with what
   fields*, not the binary path.

**Engine layer is mocked at the `core/engines/factory` boundary** — tests inject
a fake `EngineConfig` object whose `kind` (`mock-anthropic`, `mock-openai`)
resolves via a vitest module mock to a `MockLLMEngine`. The mock records every
call and returns scripted responses keyed by `findingId` or call index. The CLI
sees real `engineFamily()` (Protocol-1) and real critic-policy selection; only
the actual model call is faked.

**Preset layer uses real `loadPreset` / `runPreset`** from
`core/protocol/preset/` against tmpdir fixtures. `ZEROU_PRESET_BUILTIN_DIR`
points into the fixture so tests can ship exactly the presets they need (or
ship zero presets to exercise the empty-preset edge case).

**Cross-platform**: Unix-perm checks (B-6-2) are gated on
`process.platform !== 'win32'` with a Windows companion test that asserts the
`cli.config.windows-permission-check-skipped` debug log.

**Timing**: each subprocess test has a 30s vitest timeout; in-process tests
default to 10s.

---

## 2. Test fixtures

Helpers to be implemented under `cli/zerou-audit/__tests__/fixtures/`:

- **`tmpRepo(opts?: { git?: boolean; files?: Record<string,string> })`** —
  creates a fresh tmpdir, writes the supplied files, optionally runs
  `git init && git add -A && git commit -m initial`. Returns
  `{ cwd: string; cleanup: () => Promise<void> }`. Default `files` includes
  one trivial source file so the preset has something to scan.

- **`dirtyRepo()`** — wraps `tmpRepo({ git: true })`, then writes an extra
  uncommitted file. Returns the same shape. Used by B-1-3 / B-1-4.

- **`withPresetFixtures({ plugin?, project?, builtin? })`** — assembles a
  tmpdir laid out as the three Protocol-2 layers, returns the env vars to set:

  ```
  { env: { ZEROU_PRESET_BUILTIN_DIR, ZEROU_PRESET_PLUGIN_DIRS }, projectDir }
  ```

  Each arg is `Record<presetId, presetMarkdownContent>`. The helper supports
  putting the **same id at multiple layers** (this is required for B-3-1
  shadow test). Built-in preset fixtures are minimal valid manifests with one
  rule each.

- **`mockEngine(family: string, responses: Record<string, CriticResponse>)`** —
  registers a vitest module mock for `core/engines/factory.createEngine` that,
  given a config with `kind === 'mock-<family>'`, returns an `LLMEngine`-like
  object whose `complete()` looks up `responses[findingId]` (or a fallback
  `responses['*']`). Records all calls in
  `mockEngine.calls: Array<{findingId, prompt, family}>`.

  Helper variants: `mockEngine.confirmed()`, `mockEngine.falsePositive()`,
  `mockEngine.transportError()`, `mockEngine.invalidJson()`,
  `mockEngine.fixProposal({patch, verifyStep, reasoning})`.

- **`runCli(argv: string[], env?: Record<string,string>, cwd?: string)`** —
  spawns the built binary. Returns
  `{ stdout, stderr, exitCode, logFiles: Record<string, LogEntry[]> }`. The
  `logFiles` map is populated by walking `<cwd>/.zerou/logs/<track>/<date>/`
  and parsing every `.jsonl` line. Key: `<track>/<trace>`.

- **Configuration fixtures**:

  - `validConfig` — minimal valid `~/.zerou/config.json` content:
    `{ worker: { kind: 'mock-anthropic', modelId: 'mock-haiku-2026-05-01',
    releaseDate: '2026-05-01' }, criticPool: [{ kind: 'mock-openai',
    modelId: 'mock-gpt-2026-05-01', releaseDate: '2026-05-01' }] }`.
  - `singleEngineConfig` — `worker` only, no `criticPool`. Used for B-4-2.
  - `invalidConfig` — extra unknown top-level key + missing `worker.modelId`.
  - `unsafePermsConfig(mode: number)` — wraps `validConfig`, chmod-s to
    given mode (only meaningful on Unix). Used by B-6-2.
  - `keylessConfig` — `worker.kind: 'mock-anthropic'` but no key supplied in
    config; lets per-key precedence tests assert the env/flag promotion.

- **`tempLogRoot()`** — convenience that overrides `<cwd>/.zerou/logs` to a
  tmp location and exposes a `readLogs(track, trace)` helper so tests stay
  hermetic.

---

## 3. Test cases

Conventions:
- Test IDs: `T-X-Y-Z` where `X-Y` matches the Behavior, `Z` is sequential.
- "Assertion (log)" entries cite events from the surface's `track='cli'` and
  `track='audit'` tables. In-process tests use `captureLogsFor`; subprocess
  tests use `logFiles['cli/<trace>']` from `runCli`'s return value.
- All `--config` arguments point at a tmp file written by the test (never the
  real `~/.zerou/`).

### T-1-1-1 (covers B-1-1) — auto-init on non-git fixture

**Name**: `B-1-1: audit on a non-git fixture auto-initializes a repo and logs cli.repo.auto-init`

**Setup**:
- `tmpRepo({ git: false, files: { 'a.ts': 'const X = 1;' } })`.
- `withPresetFixtures({ builtin: { 'noop-preset': <one rule, no findings> } })`.
- `validConfig` written to a tmp config file.

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--preset', 'noop-preset'])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `0`.
- Stdout contains the header section and the summary line
  `/Of \d+ findings:/`.

**Assertion (filesystem)**:
- `<cwd>/.git/` exists after the run.
- `<cwd>/.git/HEAD` is a valid file (best-effort sanity check).

**Assertion (log)**:
- `logFiles['cli/<trace>']` contains one entry with `event: 'cli.repo.auto-init'`,
  `level: 'info'`, `cwd: <cwd>`.

---

### T-1-1-2 (covers B-1-1) — non-git fixture inside read-only parent: surface does not promise behavior here; skipped

**Negative case N/A**: the surface does not promise behavior when auto-init
itself fails (e.g. parent dir not writable). No assertion possible without
spec-side detail; omitted per "don't test what the surface doesn't promise".

---

### T-1-2-1 (covers B-1-2) — existing git fixture: no new commits

**Name**: `B-1-2: audit on an existing git fixture logs existing-git with head`

**Setup**:
- `tmpRepo({ git: true })` (one initial commit).
- `withPresetFixtures({ builtin: { 'noop-preset': ... } })`.
- Record `git rev-parse HEAD` before the run as `headBefore`.

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--preset', 'noop-preset'])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `0`.

**Assertion (filesystem)**:
- `git rev-parse HEAD` after the run equals `headBefore` (no new commits).

**Assertion (log)**:
- `cli.repo.existing-git` present, level `info`, `head: <40-char sha>` populated
  and equal to `headBefore`.
- No `cli.repo.auto-init` entry.

---

### T-1-2-2 (covers B-1-2) — git fixture with detached HEAD still logs head

**Name**: `B-1-2 edge: detached HEAD still produces a head field`

**Setup**:
- `tmpRepo({ git: true })`, then `git checkout <sha>` to detach.

**Action**:
- Same as T-1-2-1.

**Assertion (log)**:
- `cli.repo.existing-git.head` is the detached sha (string of length 40).

---

### T-1-3-1 (covers B-1-3) — dirty + --apply refuses

**Name**: `B-1-3: dirty working tree + --apply exits 3 with cli.repo.dirty`

**Setup**:
- `dirtyRepo()` (one uncommitted file).
- Snapshot fixture file mtimes before the run.

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--apply', '--preset', 'noop-preset'])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `3`.
- Stderr contains a non-empty message mentioning `--allow-dirty`.

**Assertion (filesystem)**:
- All fixture file mtimes unchanged (no fix attempted).

**Assertion (log)**:
- `cli.repo.dirty` present, level `error`, `cwd: <cwd>`.
- No `cli.apply.*` entries.

---

### T-1-4-1 (covers B-1-4) — dirty + --apply --allow-dirty proceeds

**Name**: `B-1-4: --allow-dirty suppresses dirty refusal`

**Setup**:
- `dirtyRepo()` plus one preset rule guaranteed to find one finding with a
  `fix.kind: 'template'` declaration (e.g. preset whose template rewrites a
  hard-coded string).
- `mockEngine('mock-openai', { '*': confirmedResponse })` so the finding is
  confirmed.

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--apply', '--allow-dirty',
  '--preset', 'fixable-preset'])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `0` (the fix succeeded and `--fail-on` defaults to `none`).

**Assertion (filesystem)**:
- Fixture file modified per the template.

**Assertion (log)**:
- No `cli.repo.dirty` entry.
- `cli.apply.template` entry with `findingId: <id>`.

---

### T-2-1-1 (covers B-2-1) — missing path

**Name**: `B-2-1: missing <path> exits 3 with cli.path.missing`

**Setup**:
- No fixture; compute a path guaranteed not to exist
  (`path.join(os.tmpdir(), 'nope-' + ulid())`).

**Action**:
- `runCli(['audit', missingPath, '--config', cfg])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `3`.
- Stderr non-empty.

**Assertion (log)**:
- `cli.path.missing` present, level `error`, `path: <missingPath>`.

---

### T-2-1-2 (covers B-2-1) — path is a file, not a directory

**Name**: `B-2-1 negative: <path> pointing at a file exits 3 with cli.path.missing`

**Setup**:
- Create a tmp file (regular file, not a directory).

**Action**:
- `runCli(['audit', filePath, '--config', cfg])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `3`.

**Assertion (log)**:
- `cli.path.missing` event present. (Surface does not specify a distinct
  "is-a-file" event; A-E-1 covers "<path> does not exist [as a directory]"
  and the only event documented for the A-E-1 family is `cli.path.missing`.
  This is a **surface-claim audit item** — see §5.)

---

### T-2-2-1 (covers B-2-2) — requested preset id missing

**Name**: `B-2-2: --preset <unknown> exits 3 with cli.preset.requested-missing`

**Setup**:
- `tmpRepo({ git: true })`.
- `withPresetFixtures({ builtin: { 'real-preset': ... } })` (i.e. the
  requested id is genuinely not installed at any layer).

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--preset', 'does-not-exist'])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `3`.

**Assertion (log)**:
- `cli.preset.requested-missing` present with `requestedId: 'does-not-exist'`.

---

### T-2-2-2 (covers B-2-2) — partial mix: one valid + one invalid

**Name**: `B-2-2 edge: mix of valid and invalid --preset still fails on the invalid one`

**Setup**:
- Same as T-2-2-1 plus an installed `real-preset`.

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--preset', 'real-preset',
  '--preset', 'does-not-exist'])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `3`.

**Assertion (log)**:
- `cli.preset.requested-missing` with `requestedId: 'does-not-exist'`.
- No `cli.preset.run-failed` for `real-preset` (fail-fast on missing id).

---

### T-3-1-1 (covers B-3-1) — shadow warning when same id at plugin+project

**Name**: `B-3-1: same preset id at plugin and project layers emits shadow warning`

**Setup**:
- `withPresetFixtures({ plugin: { 'X': pluginVersion }, project: { 'X': projectVersion } })`.
- `tmpRepo({ git: true })` pointed at the project layer's repo.

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--preset', 'X'])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `0` (no `--fail-on`).
- Stdout matches `/warn: preset X overridden by plugin/`.

**Assertion (log)**:
- `cli.preset.shadow-warn` present with
  `presetId: 'X'`, `winningSource: 'plugin'`,
  `shadowedSources: ['project']` (assert as set, order-insensitive).

---

### T-3-1-2 (covers B-3-1) — no shadow when ids differ across layers

**Name**: `B-3-1 negative: different ids at different layers do NOT emit shadow-warn`

**Setup**:
- `withPresetFixtures({ plugin: { 'A': ... }, project: { 'B': ... } })`.

**Action**:
- `runCli(['audit', cwd, '--config', cfg])`.

**Assertion (log)**:
- Zero `cli.preset.shadow-warn` entries.

**Assertion (stdout / stderr / exit code)**:
- Stdout does NOT contain the substring `overridden`.

---

### T-4-1-1 (covers B-4-1) — cross-family critic configured

**Name**: `B-4-1: cross-family critic produces mixed verdicts, crossFamily=true`

**Setup**:
- `validConfig` (worker `mock-anthropic`, critic pool `mock-openai`).
- Preset guaranteed to produce 3 findings.
- `mockEngine('mock-openai', { 'p.0': confirmed, 'p.1': falsePositive, 'p.2': needsContext })`.

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--preset', 'tri-finding-preset'])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `0`.
- Summary line counts: confirmed=1, false-positive=1, needs-context=1,
  critic-unavailable=0.

**Assertion (log)**:
- `cli.policy` with `crossFamily: true`.
- `audit.summary` (track `audit`) with matching counts.

---

### T-4-2-1 (covers B-4-2) — single-engine config: all critic-unavailable + nudge

**Name**: `B-4-2: single-engine config marks all findings critic-unavailable and prints nudge`

**Setup**:
- `singleEngineConfig` (no `criticPool`).
- Preset producing exactly 3 findings (worker family `mock-anthropic`).

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--preset', 'tri-finding-preset'])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `0`.
- Summary line: `/Of 3 findings: 0 confirmed.*3 critic-unavailable/`.
- Followed by the nudge line matching the exact regex:
  `/^configure a second engine \(different family from mock-anthropic\) to verdict the remaining 3\.$/m`.

**Assertion (log)**:
- `cli.policy` with `crossFamily: false`, `reason: 'no-critic-configured'`,
  `workerFamily: 'anthropic'` (per Protocol-1 family taxonomy
  `mock-anthropic` is treated by `engineFamily` — but `mock-*` is a test
  affordance, see §5 surface-audit item; the test asserts the actual value
  returned by `engineFamily` for the mock kind).
- `audit.summary` with `criticUnavailable === 3`.

---

### T-4-2-2 (covers B-4-2) — single-engine + zero findings: no nudge

**Name**: `B-4-2 negative: zero findings means no nudge line even with single engine`

**Setup**:
- `singleEngineConfig`.
- Preset producing zero findings.

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--preset', 'noop-preset'])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `0`.
- Summary line present with all counts zero.
- Stdout does NOT contain the substring `configure a second engine`.

---

### T-5-1-1 (covers B-5-1) — --fail-on p1 with confirmed P1 → exit 2

**Name**: `B-5-1: --fail-on p1 + confirmed P1 finding exits 2`

**Setup**:
- Preset whose only rule has `severity: 'P1'` and finds one match.
- `mockEngine('mock-openai', { '*': confirmed })`.

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--fail-on', 'p1',
  '--preset', 'p1-preset'])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `2`.

**Assertion (log)**:
- `audit.summary.exitCode === 2`.
- `cli.audit.end.exitCode === 2`.

---

### T-5-2-1 (covers B-5-2) — --fail-on p1 with only confirmed P2/P3 → exit 0

**Name**: `B-5-2: --fail-on p1 with no confirmed P1 exits 0`

**Setup**:
- Preset producing one `P2` and one `P3` finding (no P1).
- `mockEngine('mock-openai', { '*': confirmed })`.

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--fail-on', 'p1',
  '--preset', 'p2p3-preset'])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `0`.

**Assertion (log)**:
- `audit.summary.exitCode === 0`.

---

### T-5-2-2 (covers B-5-2) — --fail-on p1: critic-unavailable P1 does NOT count

**Name**: `B-5-2 micro: critic-unavailable P1 finding does not cross --fail-on p1`

**Setup**:
- Preset producing one P1 finding.
- `singleEngineConfig` → guaranteed `critic-unavailable`.

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--fail-on', 'p1',
  '--preset', 'p1-preset'])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `0` (per surface: "Only `verdict: 'confirmed'` findings count").

**Assertion (log)**:
- `audit.summary.counts.confirmed === 0`.
- `audit.summary.counts.criticUnavailable === 1`.
- `audit.summary.exitCode === 0`.

---

### T-5-3-1 (covers B-5-3) — --fail-on none always exits 0

**Name**: `B-5-3: --fail-on none with any confirmed finding still exits 0`

**Setup**:
- Preset producing one P1 finding, one P2 finding.
- `mockEngine` confirms both.

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--fail-on', 'none',
  '--preset', 'mixed-preset'])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `0`.

---

### T-5-3-2 (covers B-5-3) — default (no --fail-on) equivalent to --fail-on none

**Name**: `B-5-3 default: omitted --fail-on behaves like none`

**Setup**: same as T-5-3-1.

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--preset', 'mixed-preset'])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `0`.
- `audit.summary.failOnThreshold === 'none'`.

---

### T-6-1-1 (covers B-6-1) — --key redacted in process.argv + stderr note

**Name**: `B-6-1: --key value is redacted in process.argv after parse`

**Setup**:
- This test uses **in-process mode** because asserting on the subprocess's
  live `process.argv` is impossible from outside. The test calls `main()`
  with a synthetic argv array (`['node', 'zerou', 'audit', cwd, '--key',
  'openai=sk-test', '--config', cfg, '--preset', 'noop-preset']`), then
  inspects the same array post-call.
- The test additionally runs the subprocess variant and asserts the stderr
  note line.

**Action (in-process)**:
- `const argv = [...]; const exit = await main(argv);`

**Assertion (filesystem)**: none.

**Assertion (stdout / stderr / exit code)**:
- Subprocess variant: stderr contains the exact line
  `note: --key value redacted from process listing. For repeated runs, use ZEROU_OPENAI_KEY env var or ~/.zerou/config.json (chmod 600).`.

**Assertion (process.argv)**:
- After `main(argv)` returns, `argv.find(s => s.startsWith('--key'))` exists
  AND `argv[i+1] === 'openai=[REDACTED]'` where `i` is the index of `--key`.
- The literal `sk-test` does not appear anywhere in `argv` (joined-string
  search).

**Assertion (log)**:
- No log entry under any track contains the substring `sk-test` (joined
  JSON-stringify search across `logFiles`).

---

### T-6-1-2 (covers B-6-1) — multiple --key flags all redacted

**Name**: `B-6-1 multi: each --key occurrence is independently redacted`

**Setup**:
- argv with `--key openai=sk-a --key anthropic=sk-b`.

**Action**:
- In-process `main(argv)`.

**Assertion (process.argv)**:
- Both values appear as `[REDACTED]`.
- Neither `sk-a` nor `sk-b` appears anywhere in `argv`.

---

### T-6-2-1 (covers B-6-2) — unsafe perms on Unix

**Name**: `B-6-2: config with mode 0644 exits 3 with cli.config.unsafe-perms (Unix only)`

**Setup**:
- `process.platform !== 'win32'` (else `test.skip`).
- `unsafePermsConfig(0o644)` written to a tmp path.

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--preset', 'noop-preset'])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `3`.
- Stderr contains:
  `/error: .*config\.json has unsafe permissions \(0644\)\. chmod 600 the file, or pass --insecure-config to override\./`.

**Assertion (log)**:
- `cli.config.unsafe-perms` with `path: <cfg>`, `mode: '0644'`.

---

### T-6-2-2 (covers B-6-2) — --insecure-config bypasses check on Unix

**Name**: `B-6-2 bypass: --insecure-config + 0644 exits 0`

**Setup**:
- Unix only (skip on win32).
- `unsafePermsConfig(0o644)`.

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--insecure-config',
  '--preset', 'noop-preset'])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `0`.

**Assertion (log)**:
- No `cli.config.unsafe-perms` entry.

---

### T-6-2-3 (covers B-6-2) — Windows skips check

**Name**: `B-6-2 windows: perm check is skipped and logged at debug`

**Setup**:
- `process.platform === 'win32'` (else `test.skip`).
- `validConfig` written to a tmp file (mode irrelevant on Windows).

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--log-level', 'debug',
  '--preset', 'noop-preset'])`.

**Assertion (log)**:
- `cli.config.windows-permission-check-skipped`, level `debug`.
- No `cli.config.unsafe-perms`.

---

### T-6-2-4 (covers B-6-2) — --insecure-config on Windows: no-op

**Name**: `B-6-2 windows: --insecure-config on Windows is silently consumed (no extra log, no error)`

**Setup**:
- Win32 only.

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--insecure-config',
  '--preset', 'noop-preset'])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `0`.
- Stderr does not mention `--insecure-config` (no "ignored on Windows"
  message — the surface doesn't promise one; see §5 surface-audit item).

**Assertion (log)**:
- `cli.config.windows-permission-check-skipped` still present.

---

### T-7-1-1 (covers B-7-1) — --out writes parseable JSON, counts match stdout

**Name**: `B-7-1: --out writes JSON whose summary counts match stdout line`

**Setup**:
- Preset producing 4 findings of mixed severity.
- `validConfig` (cross-family critic).
- `mockEngine` returns a mix: 2 confirmed, 1 false-positive, 1 needs-context.

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--preset', 'quad-preset',
  '--out', path.join(tmp, 'bundle.json')])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `0`.

**Assertion (filesystem)**:
- `bundle.json` exists, `JSON.parse(readFileSync(...))` succeeds.
- `bundle.version === '1.0'`.
- `bundle.summary.counts === { confirmed: 2, falsePositive: 1, needsContext: 1, criticUnavailable: 0 }`.
- Parse the stdout summary line (regex `/Of (\d+) findings: (\d+) confirmed \/ (\d+) false-positive \/ (\d+) needs-context \/ (\d+) critic-unavailable/`)
  → numbers match the bundle's `summary.counts` byte-for-byte.

**Assertion (log)**:
- `cli.bundle.write-success` with `path: <bundle.json>`, `bytes: <number>`.

---

### T-7-1-2 (covers B-7-1) — --out target unwritable triggers A-E-9

**Name**: `B-7-1 negative: --out to unwritable path exits 1 with cli.bundle.write-failed`

**Setup**:
- Unix: target path inside a chmod-000 directory.
- Win32: skip (no easy unwritable equivalent without admin); document as
  Unix-only and add a TODO surface-audit note.

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--preset', 'noop-preset',
  '--out', unwritablePath])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `1`.

**Assertion (log)**:
- `cli.bundle.write-failed` with `path: <unwritablePath>`, `error: <string>`.

---

### T-7-2-1 (covers B-7-2) — bundle's worker.modelId is the FULL id, releaseDate ISO

**Name**: `B-7-2: bundle audit.engineConfig.worker.modelId is the full model id`

**Setup**:
- `validConfig` whose `worker.modelId` is e.g.
  `'mock-haiku-4-5-20251001'` (deliberately long, family-looking-prefix +
  date suffix).
- Preset noop.

**Action**:
- Run with `--out`.

**Assertion (filesystem)**:
- `bundle.audit.engineConfig.worker.modelId === 'mock-haiku-4-5-20251001'`
  (exact equality — NOT a family-name like `'mock-anthropic'`).
- `bundle.audit.engineConfig.worker.releaseDate` matches
  `/^\d{4}-\d{2}-\d{2}$/`.
- `bundle.audit.engineConfig.worker.family` is a non-empty string.

---

### T-7-2-2 (covers B-7-2) — bundle's critic field null when single-engine

**Name**: `B-7-2 negative: bundle.audit.engineConfig.critic === null when no cross-family critic`

**Setup**:
- `singleEngineConfig`.

**Action**:
- Run with `--out`.

**Assertion (filesystem)**:
- `bundle.audit.engineConfig.critic === null`.
- `bundle.findings.every(f => f.verdict === 'critic-unavailable')` (if any).

---

### T-7-3-1 (covers B-7-3) — inputFiles enumerates every file read

**Name**: `B-7-3: bundle.inputFiles has one entry per file actually read`

**Setup**:
- `tmpRepo({ files: { 'a.ts': '...', 'b.ts': '...', 'c.txt': '...' } })`.
- Preset whose `static-grep` rule applies to `**/*.ts` (only 2 files match
  the fileFilter / glob).

**Action**:
- Run with `--out`.

**Assertion (filesystem)**:
- `bundle.inputFiles.length === 2`.
- The paths sorted equal `['a.ts', 'b.ts']`.
- Each entry has `sha256` matching `/^[0-9a-f]{64}$/`.

---

### T-7-3-2 (covers B-7-3) — inputFiles excludes files explicitly skipped

**Name**: `B-7-3 negative: files filtered out by preset (e.g. node_modules) are NOT in inputFiles`

**Setup**:
- `tmpRepo({ files: { 'src/a.ts': '...', 'node_modules/x/y.ts': '...' } })`.
- Preset whose runner default `fileFilter` excludes `node_modules/`
  (per Protocol-2 surface default).

**Action**:
- Run with `--out`.

**Assertion (filesystem)**:
- `bundle.inputFiles.map(f => f.path)` does NOT include any path matching
  `node_modules/`.

---

### T-8-1-1 (covers B-8-1) — template fix applied + cli.apply.template logged

**Name**: `B-8-1: confirmed template-fix finding modifies the file and logs cli.apply.template`

**Setup**:
- `tmpRepo({ git: true, files: { 'env.ts': 'const KEY = "hard-coded";' } })`.
- Preset with rule `static-grep` matching `hard-coded`, `fix.kind: 'template'`,
  `fix.command` performing the codemod.
- `validConfig` + critic mock returns `confirmed`.

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--apply', '--preset', 'fixable-preset'])`.

**Assertion (stdout / stderr / exit code)**:
- Exit code `0`.

**Assertion (filesystem)**:
- `env.ts` no longer contains the literal `hard-coded` (template's intended
  modification was applied).

**Assertion (log)**:
- `cli.apply.template` with `findingId: <the finding's id>`.
- Bundle (if `--out` set in a sibling test variant) reports
  `apply.templateApplied >= 1`.

---

### T-8-1-2 (covers B-8-1) — template fix NOT applied when finding is false-positive

**Name**: `B-8-1 negative: false-positive template finding leaves file untouched`

**Setup**:
- Same as T-8-1-1 but critic mock returns `falsePositive`.

**Action**:
- `runCli([..., '--apply', ...])`.

**Assertion (filesystem)**:
- `env.ts` unchanged.

**Assertion (log)**:
- Zero `cli.apply.template` entries.
- The bundle (variant with `--out`) has `apply.templateApplied === 0`.

---

### T-8-2-1 (covers B-8-2) — llm-only + verified:false → skipped + warn log

**Name**: `B-8-2: llm-only fix with verified=false is skipped and logged`

**Setup**:
- Preset rule with `fix.kind: 'llm-only'`, producing one finding.
- `validConfig` (cross-family).
- `mockEngine.fixProposal({ patch: '...', verifyStep: 'false', verified: false })`
  — mock returns a proposal that the framework will mark `verified: false`
  (e.g. patch fails to apply, or verifyStep exits 0 → finding still present).
- Critic verdict mock returns `confirmed` so the finding qualifies for apply.
- Snapshot file contents before run.

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--apply', '--allow-dirty',
  '--preset', 'llm-only-preset', '--out', path.join(tmp, 'b.json')])`.

**Assertion (filesystem)**:
- Target file contents unchanged.
- `bundle.apply.llmUnverifiedSkipped >= 1`.
- `bundle.apply.llmVerifiedApplied === 0`.

**Assertion (log)**:
- `cli.apply.skip-unverified` with `findingId: <id>`, level `warn`.

---

### T-8-2-2 (covers B-8-2) — llm-only + verified:true → applied

**Name**: `B-8-2 positive twin: llm-only with verified=true applies the patch`

**Setup**:
- Same as T-8-2-1 but mock returns a proposal that the framework will mark
  `verified: true` (patch applies cleanly, verifyStep exits non-zero).

**Action**: same.

**Assertion (filesystem)**:
- Target file modified per the patch.
- `bundle.apply.llmVerifiedApplied >= 1`.

**Assertion (log)**:
- `cli.apply.llm-verified` with `findingId: <id>`.

---

### T-9-1-1 (covers B-9-1) — no log file contains the literal --key value

**Name**: `B-9-1: literal --key value 'sk-secret-test' appears in zero log files`

**Setup**:
- `tmpRepo({ git: true })`.
- Preset producing one llm-judgment finding (so the critic IS invoked,
  maximizing the surface area for accidental leaks).
- `mockEngine.confirmed()`.
- `validConfig` (the config does NOT contain the key — the key is supplied
  via `--key`).

**Action**:
- `runCli(['audit', cwd, '--config', cfg, '--log-level', 'debug',
  '--key', 'mock-openai=sk-secret-test',
  '--preset', 'llm-rule-preset'])`.

**Assertion (filesystem + log)**:
- After the run, enumerate every `.jsonl` file under
  `<cwd>/.zerou/logs/**/*.jsonl`.
- For each file, raw-string search for the literal substring `sk-secret-test`.
- Assert the total occurrence count across ALL files is `0`.
- Also enumerate `bundle.json` (if `--out` set in a sibling) and the stderr
  capture — assert zero occurrences there too.

**Assertion (stdout / stderr / exit code)**:
- Stdout does NOT contain `sk-secret-test`.
- Stderr does NOT contain `sk-secret-test` (the note line uses
  `[REDACTED]`, not the value).

---

### T-9-1-2 (covers B-9-1) — engine config objects in logs have no apiKey field

**Name**: `B-9-1 micro: any cli.engine.* log entry's payload has no 'apiKey' or 'key' field`

**Setup**:
- Same as T-9-1-1.

**Assertion (log)**:
- Walk every entry in every `track='cli'` log file. For any entry whose
  `event` starts with `cli.engine.` OR whose payload includes an
  engine-config-shaped object (heuristic: key set is a superset of
  `{kind, modelId, releaseDate}`), assert that neither `apiKey` nor `key`
  appears as a key in the payload (recursive).

---

### Bonus: legacy `~/.d2p/` fallback (covers B-1-x family via cli.config.legacy-d2p-path-used event)

> The public surface lists this log event but doesn't carve out a `B-X-Y` ID
> for it. Test included to ensure the legacy fallback claim from the surface
> is honored. See §5 surface-audit item about the missing Behavior ID.

### T-CFG-LEGACY-1 — legacy fallback when only `~/.d2p/` exists

**Name**: `legacy: missing ~/.zerou/config.json but present ~/.d2p/config.json reads from ~/.d2p/ and logs`

**Setup**:
- Override `os.homedir()` (or set `HOME`/`USERPROFILE` to a tmpdir) so the
  CLI looks in a fake home.
- Create `<fakeHome>/.d2p/config.json` with `validConfig`.
- Do NOT create `<fakeHome>/.zerou/config.json`.

**Action**:
- `runCli(['audit', cwd, '--preset', 'noop-preset'])` (no `--config`).

**Assertion (stdout / stderr / exit code)**:
- Exit code `0`.

**Assertion (log)**:
- `cli.config.legacy-d2p-path-used` with
  `fallbackPath: <fakeHome>/.d2p/config.json`, level `info`.

---

### T-CFG-LEGACY-2 — `~/.zerou/` wins when both exist

**Name**: `legacy negative: ~/.zerou/config.json takes precedence; no legacy log`

**Setup**:
- Both `<fakeHome>/.zerou/config.json` (with `validConfig`) AND
  `<fakeHome>/.d2p/config.json` (with a *different* config that would fail
  if read — e.g. invalid kind).

**Action**:
- Same as T-CFG-LEGACY-1.

**Assertion (stdout / stderr / exit code)**:
- Exit code `0` (proves the `.zerou` valid config was the one used).

**Assertion (log)**:
- ZERO `cli.config.legacy-d2p-path-used` entries.

---

### Bonus: --version / --help (covers exit-code claim only, no Behavior ID)

### T-META-1 — `--help` exits 0

### T-META-2 — `--version` exits 0 and prints `<semver>` to stdout

Both subprocess runs, asserting only `exitCode === 0` and that stdout is
non-empty. No log assertions (the surface does not promise log emission for
these).

---

## 4. Coverage map

| Behavior | Tests |
|---|---|
| B-1-1 | T-1-1-1; T-1-1-2 (N/A justified — surface silent on auto-init failure mode) |
| B-1-2 | T-1-2-1; T-1-2-2 |
| B-1-3 | T-1-3-1 (single test — pure positive failure path; symmetric negative is T-1-4-1) |
| B-1-4 | T-1-4-1 |
| B-2-1 | T-2-1-1; T-2-1-2 |
| B-2-2 | T-2-2-1; T-2-2-2 |
| B-3-1 | T-3-1-1; T-3-1-2 |
| B-4-1 | T-4-1-1 (companion: T-7-1-1 also exercises a cross-family run with bundle assertion) |
| B-4-2 | T-4-2-1; T-4-2-2 |
| B-5-1 | T-5-1-1 |
| B-5-2 | T-5-2-1; T-5-2-2 |
| B-5-3 | T-5-3-1; T-5-3-2 |
| B-6-1 | T-6-1-1; T-6-1-2 |
| B-6-2 | T-6-2-1; T-6-2-2; T-6-2-3; T-6-2-4 |
| B-7-1 | T-7-1-1; T-7-1-2 |
| B-7-2 | T-7-2-1; T-7-2-2 |
| B-7-3 | T-7-3-1; T-7-3-2 |
| B-8-1 | T-8-1-1; T-8-1-2 |
| B-8-2 | T-8-2-1; T-8-2-2 |
| B-9-1 | T-9-1-1; T-9-1-2 |
| (legacy fallback — no B-ID) | T-CFG-LEGACY-1; T-CFG-LEGACY-2 |
| (meta flags — no B-ID) | T-META-1; T-META-2 |

**Log-assertion coverage**: 28 of 33 documented test cases include an
`Assertion (log)` block. (T-1-1-2 is N/A skipped, T-7-2-1/T-7-2-2/T-7-3-1/T-7-3-2
are pure filesystem-shape assertions on the bundle, and T-META-* are exit-code
only.) Comfortably above the 50% minimum.

**B-1-3 justification for single test**: The behavior is "dirty + --apply
without --allow-dirty refuses". Its symmetric negative IS B-1-4 (dirty +
--apply WITH --allow-dirty proceeds), which has its own ID and its own test
T-1-4-1. Writing a second test under B-1-3 would duplicate T-1-4-1 verbatim.

---

## 5. Surface-claim audit

Items the test author flagged while writing this plan. Each is either a real
contract gap to feed back into the surface doc, or a confirmation that the
surface intentionally under-specifies and the test plan respects that.

1. **Q11 micro nudge wording** — the surface DOES give the exact wording:

   ```
   configure a second engine (different family from <workerKind>) to verdict the remaining <criticUnavailable>.
   ```

   Open question: is `<workerKind>` the raw `EngineConfig.kind` string
   (e.g. `anthropic-api`) or the family (`anthropic`)? The surface says
   "from `<workerKind>`" which reads as the kind. T-4-2-1 asserts the
   literal `mock-anthropic` (the kind). **Recommend the surface clarify
   explicitly** — current wording is ambiguous between
   `EngineConfig.kind` and `engineFamily(worker)`.

2. **`--apply` + critic-unavailable + `--fail-on`** — the surface is
   explicit: "Only `verdict: 'confirmed'` findings count toward the
   `--fail-on` threshold; `'critic-unavailable'` does not." Therefore a
   critic-unavailable finding that *would* have been P1 cannot, by spec,
   cause exit code 2 — even if `--apply` did nothing. T-5-2-2 locks this in.
   The surface is unambiguous here; no gap.

   Secondary question the surface does NOT answer: when `--apply` is set
   AND every confirmed finding has only an `llm-only` proposal AND every
   proposal returns `verified: false`, what's the exit code? Reading the
   surface: nothing was applied, but the confirmed findings still count
   for `--fail-on`. So `--fail-on p1` + confirmed P1 + skip-unverified →
   exit `2`. Worth adding an explicit test (could be T-5-1-2) but the
   surface is technically clear; flagging here for review.

3. **Legacy `~/.d2p/` fallback ordering** — surface says "if
   `~/.zerou/config.json` does NOT exist AND `~/.d2p/config.json` DOES
   exist". This is unambiguously sequential ("does NOT exist" is checked
   first). T-CFG-LEGACY-1 and T-CFG-LEGACY-2 exercise both directions.
   **However**: the surface does NOT define a Behavior ID for this fallback
   (no `B-X-Y`). The test plan therefore parks it under `T-CFG-LEGACY-*`
   outside the B-ID coverage map. **Recommend the surface add a Behavior ID**
   (e.g. B-6-3 "legacy `~/.d2p/` fallback") so this gets first-class
   coverage tracking.

4. **`--insecure-config` on Windows** — surface says "Skip the
   unsafe-perms check on `~/.zerou/config.json` (Unix only)". By
   strict reading, on Windows the check is already skipped, so
   `--insecure-config` is a no-op. The surface does NOT say whether the
   flag is silently accepted or whether it emits a "ignored on Windows"
   warning. T-6-2-4 asserts the conservative interpretation (silently
   consumed, no extra log). **Recommend the surface state explicitly
   "`--insecure-config` is silently accepted on Windows; no warning"**
   (or the opposite, if the implementation actually warns).

5. **Stdout color** — surface explicitly says: "Test cases SHOULD NOT
   depend on exact ANSI sequences." This plan complies: every stdout
   assertion uses substring or non-ANSI regex matches. T-3-1-1's
   `/warn: preset X overridden by plugin/` is a plain-text regex, not
   colored. No test asserts on ANSI escape codes anywhere.

6. **`audit.summary` (track=`audit`) vs `cli.audit.end` (track=`cli`)
   timing** — surface says: "audit.summary event timing is strictly after
   `cli.audit.end` — both are emitted just before exit but order across
   separate loggers is not specified." Therefore no test asserts ordering
   between these two events. Tests that need both (T-4-1-1, T-4-2-1,
   T-5-1-1, T-5-2-x) read each from its own track's log file independently
   and assert only field contents, never inter-track timing.

7. **`mock-*` engine kinds and `engineFamily` taxonomy** — the test plan
   assumes the test scaffolding registers `mock-anthropic` /
   `mock-openai` engine kinds and that the real `engineFamily()` function
   (Protocol-1) returns *something* for them. The Protocol-1 surface
   (`14-`) only enumerates `claude-cli`, `anthropic-api`, `codex-cli`,
   `gemini-cli`, `openai-compat`. **Gap**: there's no documented way to
   register a test-only engine kind whose family is deterministic.
   The test plan's pragmatic answer is to use real `claude-cli` /
   `codex-cli` kinds with a vitest module mock on
   `core/engines/factory.createEngine` so `engineFamily` returns
   `'anthropic'` / `'openai'` for them. T-4-2-1's assertion on
   `workerFamily: 'anthropic'` reflects that — the test should use
   `worker.kind: 'claude-cli'` (with the mock intercepting the factory),
   not `mock-anthropic`. **Recommend the surface either (a) document a
   test-only engine kind affordance, or (b) explicitly state that tests
   are expected to mock at the factory layer using real kinds.**

8. **`--key` `note` line provider name uppercasing** — surface says the
   note line is `... use ZEROU_<PROVIDER>_KEY env var ...`. T-6-1-1
   asserts the exact `ZEROU_OPENAI_KEY` for `--key openai=...`. The env
   var section says "Provider is uppercased + hyphens→underscores
   (e.g. `ZEROU_OPENAI_COMPAT_KEY`)". Consistent — no gap.

9. **`A-E-7` vs `cli.preset.run-failed` event** — surface error code
   table maps A-E-7 to exit 1; event table lists `cli.preset.run-failed`
   with required `errorCode` field. The plan does not include a dedicated
   test for A-E-7 because triggering `PRESET-E-7` from `runPreset`
   requires the CLI to invoke `runPreset` *without* a `criticPolicy` on a
   manifest containing an `llm-judgment` rule — but per the surface's
   Protocol-2 contract, the CLI always builds a `criticPolicy`
   (`cli.policy` event is unconditional). So A-E-7 is structurally
   unreachable from the CLI. **Surface-audit recommendation**: either
   document A-E-7 as defensive (impossible from CLI by construction, but
   handled), or add a B-ID for the conditions that would trigger it.
   Currently no test.

10. **`audit.summary` event payload "full `EvidenceBundle.summary`
    contents"** — the surface says the `audit.summary` event under
    `track='audit'` carries the full summary block. Tests T-4-1-1 /
    T-4-2-1 / T-5-1-1 spot-check `counts`, `failOnThreshold`, `exitCode`
    fields. The `byPreset` map is *not* spot-checked anywhere — adding a
    test that asserts `byPreset` keys match the preset ids and counts sum
    to the top-level `counts` would tighten coverage. Recommend adding
    T-7-1-3 (covers B-7-1) or a new bonus test for this.

11. **`cli.fatal` event** — surface lists `cli.fatal` (error) for A-E-8
    (uncaught exception). No test deliberately triggers it because the
    only repeatable way to induce A-E-8 is to inject a programming bug
    into the runtime, which the surface doesn't expose a hook for. Flagged
    as untestable from the public surface. **Recommend** either (a) leave
    A-E-8 as "best-effort" or (b) expose a `--__panic` debug flag for
    test-only assertion. Currently no test.

12. **`cli.config.invalid` event vs `--config` malformed file** — surface
    says A-E-3 fires on "Config file invalid (zod validation failure)".
    Not covered above. **Recommend adding T-CFG-INVALID-1** with an
    `invalidConfig` fixture that asserts exit 3 + `cli.config.invalid`
    event with `errorCode: 'A-E-3'`, `issues: <string>`. Omitted from the
    Behavior ID coverage because the surface doesn't carve out a B-ID for
    A-E-3 path either.

13. **Bundle counter alignment with `apply` field** — surface says the
    bundle has optional `apply` object with `templateApplied`,
    `llmVerifiedApplied`, `llmUnverifiedSkipped`. It does NOT promise that
    the sum equals the number of confirmed findings (some may have no
    proposal at all → `cli.apply.skip-no-proposal` event, which the
    surface lists but with no corresponding bundle counter). **Gap**: is
    there a `apply.skipNoProposal: number` field on the bundle, or is
    that path silent? The bundle JSON schema in §5 of the surface lists
    only 3 counters under `apply`. Tests for B-8-1/B-8-2 do not assert
    `skipNoProposal` exists. Recommend the surface either add the
    counter or explicitly state it's omitted.

---

## Files I read

Files I read: D:\lll\d2p\docs\details\15-hardener-cli-public-surface.md, D:\lll\d2p\CONTEXT.md, D:\lll\d2p\docs\details\12-log-module-public-surface.md, D:\lll\d2p\docs\details\13-protocol-2-public-surface.md, D:\lll\d2p\docs\details\14-protocol-1-public-surface.md

**Violations**: none. Did not open `15-hardener-cli-spec.md`, did not open any
source under `daemon/`, `cli/`, or `core/`, did not open any other file under
`docs/details/` beyond the four allowed surface docs.
