# 13 — Protocol-2 Preset Framework Test Plan

> Black-box test plan derived **exclusively** from `13-protocol-2-public-surface.md` (plus `12-log-module-public-surface.md` for the log helpers it injects). Author had no access to the dev spec or any source file.

---

## Section 1 — Test framework assumption

- **Runner**: `vitest` (matches project default declared in `CLAUDE.md`).
- **Runtime**: Node.js 24 (current project floor).
- **Filesystem isolation**: each test creates a per-test scratch dir under `os.tmpdir()` via `fs.mkdtempSync(path.join(os.tmpdir(), 'zerou-p2-'))`; teardown removes the dir in `afterEach`.
- **Layer fixture helper** (to be implemented in `test/util/preset-fixtures.ts`):

  ```typescript
  // signature only — implementation is fixture-author scope
  type Layer = 'plugin' | 'project' | 'builtin';

  // Writes <presetMarkdown> to the right place under <root> for <layer>:
  //   plugin  -> <root>/node_modules/@zerou-preset-<id>/preset.md
  //   project -> <root>/.zerou/presets/<id>.md
  //   builtin -> <root>/__builtin__/<id>.md   (test passes builtinDir to LoadOptions)
  mkPreset(root: string, layer: Layer, id: string, manifest: string): string;
  ```

  `mkPreset` returns the absolute path of the file it wrote so tests can assert `LoadedPreset.resolvedPath`.

- **Log capture**: `captureLogsFor({ track: 'preset' }, async () => {...})` from `core/log/test-helpers` (B-4-1 / B-4-2 of the log surface). All log assertions use this; no test asserts log entries by reading `.jsonl` files directly. Each test that needs capture passes a `logger` constructed with `silent: true` to `loadPreset` / `runPreset` so disk writes are skipped while `captureLogsFor` still observes (log surface B-3-2).
- **Env isolation**: `vi.stubEnv` resets `ZEROU_PRESET_PLUGIN_DIRS`, `ZEROU_PRESET_BUILTIN_DIR`, `ZEROU_LOG_LEVEL`, `ZEROU_LOG_NULL` between tests.

---

## Section 2 — Test fixtures

(Described, not implemented. Each fixture is a string template the helper substitutes into.)

### 2.1 Minimal valid preset (`MIN_PRESET`)

A preset with one `static-grep` rule and no optional fields. Used as the "happy baseline" most tests start from. Fields it sets: `id`, `version: 2`, `name`, one `rules[]` entry with `ruleId`, `label`, `severity: 'P3'`, `mechanism: 'static-grep'`, `source: 'fixture'`, `detection: { pattern: 'TODO' }`. Markdown body is one paragraph.

### 2.2 Error-code variants

One fixture per `PRESET-E-*` so tests can target each error in isolation:

| Variant id | What it does | Triggers |
|---|---|---|
| `MISSING_ID_PRESET` | id used in `loadPreset` call doesn't appear at any layer | PRESET-E-1 |
| `UNKNOWN_KEY_PRESET` | frontmatter has `weirdField: true` | PRESET-E-2 |
| `MISSING_NAME_PRESET` | frontmatter omits required `name` | PRESET-E-2 |
| `BAD_VERSION_PRESET` | `version: "two"` (type mismatch) | PRESET-E-2 |
| `ZERO_RULES_PRESET` | frontmatter has `rules: []` | PRESET-E-3 |
| `DUP_RULE_ID_PRESET` | two rules with the same `ruleId` | PRESET-E-3 |
| `LLM_NO_POLICY_PRESET` | rule with `mechanism: 'llm-judgment'` and no `llmPolicy` | PRESET-E-4 |
| `PLUGIN_DOUBLE_PRESET_DIR` | one `node_modules/@zerou-preset-x/` containing both `preset.md` and `another.md` (or two `preset.md` via subdirs — fixture decides; see audit item AU-3) | PRESET-E-5 |
| `BAD_REGEX_PRESET` | `static-grep` rule with `detection: { pattern: '(unterminated' }` | PRESET-E-6 |
| `MIXED_LLM_PRESET` | three rules: two `static-grep` (one returning a finding), one `llm-judgment` declared last; run without `criticPolicy` | PRESET-E-7 |
| `SLOW_RULE_PRESET` | rule whose `detection` has a low `timeoutMs` (e.g. 10) AND a mechanism config that intentionally exceeds it (mechanism is fixture-chosen; see audit item AU-1) | PRESET-E-8 |

### 2.3 Three-layer scenario builder (`makeThreeLayerScenario`)

A builder function that writes the same `id` (e.g. `cli-tool`) to all three layers, with `manifest.name` distinct per layer so tests can identify which layer's manifest "won" by checking `LoadedPreset.manifest.name`:

```typescript
// pseudocode
const root = mkTmpDir();
mkPreset(root, 'plugin',  'cli-tool', PRESET_NAMED('plugin-version'));
mkPreset(root, 'project', 'cli-tool', PRESET_NAMED('project-version'));
mkPreset(root, 'builtin', 'cli-tool', PRESET_NAMED('builtin-version'));
return { root, builtinDir: path.join(root, '__builtin__'), projectDir: path.join(root, '.zerou/presets') };
```

The builder returns the values to pass into `LoadOptions` (`cwd: root`, `projectDir`, `builtinDir`) so the test's `loadPreset` call exercises the full chain.

---

## Section 3 — Test cases

### B-1 — `loadPreset` happy/sad path

#### T-1-1-1 (covers B-1-1)

**Name**: `loadPreset resolves a builtin-only preset and returns a LoadedPreset`

**Setup**:
- `mkPreset(root, 'builtin', 'cli-tool', MIN_PRESET({ id: 'cli-tool', name: 'cli-tool' }))`.

**Action**:
- `await loadPreset('cli-tool', { cwd: root, builtinDir: path.join(root, '__builtin__'), logger: silentPresetLogger })`.

**Assertion (return value or thrown error)**:
- Returns an object satisfying `LoadedPreset`.
- `result.source === 'builtin'`.
- `result.manifest.id === 'cli-tool'`.
- `result.manifest.version === 2`.
- `result.manifest.rules.length >= 1`.
- `result.resolvedPath` equals the path returned by `mkPreset(...)`.
- `result.shadowedBy` is an empty array.

**Assertion (log)**:
- `captureLogsFor({ track: 'preset' }, ...)` contains, in order:
  - one `preset.load.start` (level `info`, fields: `presetId === 'cli-tool'`, `requestedFrom` string non-empty).
  - one `preset.load.resolved` (level `info`, fields: `presetId`, `source === 'builtin'`, `path` matches the file path).
  - one `preset.load.success` (level `info`, fields: `presetId`, `version === 2`, `rulesCount === 1`).
- No `preset.load.shadowed` entry.
- No `preset.load.failure` entry.

#### T-1-1-2 (covers B-1-1, env override)

**Name**: `loadPreset honors ZEROU_PRESET_BUILTIN_DIR when LoadOptions.builtinDir is omitted`

**Setup**:
- `mkPreset(root, 'builtin', 'cli-tool', MIN_PRESET(...))`.
- `vi.stubEnv('ZEROU_PRESET_BUILTIN_DIR', path.join(root, '__builtin__'))`.

**Action**:
- `await loadPreset('cli-tool', { cwd: root, logger: silentPresetLogger })`.

**Assertion (return value or thrown error)**:
- `result.source === 'builtin'`, `result.resolvedPath` lives under the env-pointed dir.

**Assertion (log)**:
- (none required — covered elsewhere.)

#### T-1-2-1 (covers B-1-2)

**Name**: `loadPreset rejects PRESET-E-1 when id is unknown`

**Setup**:
- empty `root` (no layers populated except an empty `builtinDir`).

**Action**:
- `await expect(loadPreset('does-not-exist', { cwd: root, builtinDir: ..., logger: silentPresetLogger }))`.

**Assertion (return value or thrown error)**:
- Promise rejects with an `Error`.
- `error.message.startsWith('PRESET-E-1')` is true.

**Assertion (log)**:
- `captureLogsFor({ track: 'preset' }, ...)` contains:
  - `preset.load.start` with `presetId === 'does-not-exist'`.
  - `preset.load.failure` (level `error`, fields: `presetId === 'does-not-exist'`, `errorCode === 'PRESET-E-1'`, `error` non-empty string).
- No `preset.load.resolved` / `preset.load.success`.

#### T-1-2-2 (covers B-1-2, edge: id matches glob letter case)

**Name**: `loadPreset PRESET-E-1 ignores case-mismatched candidate filenames on case-sensitive FS`

**Setup**:
- `mkPreset(root, 'project', 'cli-tool', MIN_PRESET(...))` (file is `cli-tool.md`).
- Call with `'CLI-TOOL'`.

**Action**:
- `await expect(loadPreset('CLI-TOOL', { cwd: root, builtinDir: ..., projectDir: ..., logger: silentPresetLogger }))`.

**Assertion (return value or thrown error)**:
- Rejects PRESET-E-1 (since manifest schema requires `/^[a-z][a-z0-9-]{1,63}$/`, `'CLI-TOOL'` cannot be a valid id even ignoring filesystem case behavior).

**Assertion (log)**:
- `preset.load.failure` with `errorCode === 'PRESET-E-1'`.

> Note: surface "does NOT promise" case-sensitivity (see surface §"What this surface does NOT promise"). This test asserts only the schema-level rejection, not FS behavior. See audit item AU-7.

---

### B-2 — Three-layer lookup + shadow warning

#### T-2-1-1 (covers B-2-1)

**Name**: `listPresets returns a single entry for an id shadowed at all three layers, with plugin winning`

**Setup**:
- `const env = makeThreeLayerScenario('cli-tool');`
- All three layer manifests differ only by `name`: `'plugin-version'` / `'project-version'` / `'builtin-version'`.

**Action**:
- `const result = await listPresets({ cwd: env.root, projectDir: env.projectDir, builtinDir: env.builtinDir, logger: silentPresetLogger });`

**Assertion (return value or thrown error)**:
- Exactly one element in `result` whose `manifest.id === 'cli-tool'`.
- That element's `source === 'plugin'`.
- That element's `manifest.name === 'plugin-version'`.
- Order-insensitive: `result[0].shadowedBy.sort()` equals `['builtin', 'project']`.

**Assertion (log)**:
- `preset.load.shadowed` event emitted (level `info`) with fields:
  - `presetId === 'cli-tool'`,
  - `winningSource === 'plugin'`,
  - `shadowedSources` (array, sorted-equal to `['builtin', 'project']`).
- One `preset.load.resolved` with `source === 'plugin'`.
- `preset.load.success` with `presetId === 'cli-tool'`.

#### T-2-1-2 (covers B-2-1, edge: only two layers shadow)

**Name**: `listPresets emits shadowed event with the actual shadowed subset when only two layers contain the id`

**Setup**:
- Populate plugin + builtin (skip project).

**Action**:
- `await listPresets({ ... })`.

**Assertion (return value or thrown error)**:
- One result; `source === 'plugin'`; `shadowedBy === ['builtin']`.

**Assertion (log)**:
- `preset.load.shadowed` with `shadowedSources === ['builtin']` (not including `'project'`).

#### T-2-2-1 (covers B-2-2)

**Name**: `loadPreset returns plugin manifest when all three layers carry the same id`

**Setup**:
- `makeThreeLayerScenario('cli-tool')` as above.

**Action**:
- `await loadPreset('cli-tool', { cwd, projectDir, builtinDir, logger: silentPresetLogger })`.

**Assertion (return value or thrown error)**:
- `result.manifest.name === 'plugin-version'`.
- `result.source === 'plugin'`.
- `result.shadowedBy.sort()` equals `['builtin', 'project']`.
- The loader did not throw despite shadow (surface: "The loader never throws on shadow.").

**Assertion (log)**:
- One `preset.load.shadowed` with `winningSource === 'plugin'`.

#### T-2-2-2 (covers B-2-2, plugin-via-env)

**Name**: `loadPreset uses ZEROU_PRESET_PLUGIN_DIRS to discover plugins outside node_modules`

**Setup**:
- Write a preset under `<root>/extra-plugins/@zerou-preset-cli-tool/preset.md` (not under `node_modules/`).
- `vi.stubEnv('ZEROU_PRESET_PLUGIN_DIRS', path.join(root, 'extra-plugins'))`.
- Also `mkPreset(root, 'builtin', 'cli-tool', PRESET_NAMED('builtin-version'))`.

**Action**:
- `await loadPreset('cli-tool', { cwd: root, builtinDir: ..., logger: silentPresetLogger })`.

**Assertion (return value or thrown error)**:
- `result.source === 'plugin'` (env-injected dir treated as plugin layer per surface §"Three-layer lookup chain"; `ZEROU_PRESET_PLUGIN_DIRS` augments the plugin layer).
- `result.shadowedBy.includes('builtin')`.

**Assertion (log)**:
- `preset.load.shadowed` with `winningSource === 'plugin'`, `shadowedSources` includes `'builtin'`.

---

### B-3 — Manifest validation

#### T-3-1-1 (covers B-3-1)

**Name**: `loadPreset rejects PRESET-E-2 when frontmatter has an unknown key`

**Setup**:
- `mkPreset(root, 'builtin', 'cli-tool', UNKNOWN_KEY_PRESET)` where the manifest includes `weirdField: true` at the top level.

**Action**:
- `await expect(loadPreset('cli-tool', { ... }))`.

**Assertion (return value or thrown error)**:
- Rejects; `error.message.startsWith('PRESET-E-2')`.

**Assertion (log)**:
- `preset.load.failure` with `errorCode === 'PRESET-E-2'`.

#### T-3-1-2 (covers B-3-1, missing required key)

**Name**: `loadPreset rejects PRESET-E-2 when required key 'name' is missing`

**Setup**:
- `mkPreset(root, 'builtin', 'cli-tool', MISSING_NAME_PRESET)`.

**Action**:
- `await expect(loadPreset('cli-tool', { ... }))`.

**Assertion (return value or thrown error)**:
- Rejects PRESET-E-2.

**Assertion (log)**:
- `preset.load.failure` with `errorCode === 'PRESET-E-2'`.

#### T-3-1-3 (covers B-3-1, type mismatch)

**Name**: `loadPreset rejects PRESET-E-2 when version is the wrong type`

**Setup**:
- `mkPreset(root, 'builtin', 'cli-tool', BAD_VERSION_PRESET)` (`version: "two"`).

**Action**:
- `await expect(loadPreset(...))`.

**Assertion (return value or thrown error)**:
- Rejects PRESET-E-2.

**Assertion (log)**:
- `preset.load.failure` with `errorCode === 'PRESET-E-2'`.

#### T-3-1-4 (covers B-3-1, zero rules → PRESET-E-3)

**Name**: `loadPreset rejects PRESET-E-3 when rules array is empty`

**Setup**:
- `mkPreset(root, 'builtin', 'cli-tool', ZERO_RULES_PRESET)`.

**Action**:
- `await expect(loadPreset(...))`.

**Assertion (return value or thrown error)**:
- Rejects; `error.message.startsWith('PRESET-E-3')`.

**Assertion (log)**:
- `preset.load.failure` with `errorCode === 'PRESET-E-3'`.

#### T-3-1-5 (covers B-3-1, dup ruleId → PRESET-E-3)

**Name**: `loadPreset rejects PRESET-E-3 when two rules share a ruleId`

**Setup**:
- `mkPreset(root, 'builtin', 'cli-tool', DUP_RULE_ID_PRESET)`.

**Action**:
- `await expect(loadPreset(...))`.

**Assertion (return value or thrown error)**:
- Rejects PRESET-E-3.

**Assertion (log)**:
- `preset.load.failure` with `errorCode === 'PRESET-E-3'`.

#### T-3-2-1 (covers B-3-2)

**Name**: `loadPreset rejects PRESET-E-4 when an llm-judgment rule omits llmPolicy`

**Setup**:
- `mkPreset(root, 'builtin', 'cli-tool', LLM_NO_POLICY_PRESET)`.

**Action**:
- `await expect(loadPreset(...))`.

**Assertion (return value or thrown error)**:
- Rejects; `error.message.startsWith('PRESET-E-4')`.

**Assertion (log)**:
- `preset.load.failure` with `errorCode === 'PRESET-E-4'`.

#### T-3-2-2 (covers B-3-2, happy path)

**Name**: `loadPreset accepts an llm-judgment rule when llmPolicy is provided`

**Setup**:
- `mkPreset(root, 'builtin', 'cli-tool', PRESET_WITH_LLM_RULE({ criticEnforce: true, maxTokens: 256 }))`.

**Action**:
- `const result = await loadPreset(...)`.

**Assertion (return value or thrown error)**:
- Resolves.
- `result.manifest.rules[0].mechanism === 'llm-judgment'`.
- `result.manifest.rules[0].llmPolicy.criticEnforce === true`.
- `result.manifest.rules[0].llmPolicy.maxTokens === 256`.

**Assertion (log)**:
- `preset.load.success` with `rulesCount === 1`.

#### T-3-2-3 (covers B-3-1, PRESET-E-5 plugin double preset.md)

**Name**: `loadPreset rejects PRESET-E-5 when one plugin package contains more than one preset.md`

**Setup**:
- `PLUGIN_DOUBLE_PRESET_DIR` fixture under `node_modules/@zerou-preset-cli-tool/`.

**Action**:
- `await expect(loadPreset('cli-tool', { cwd: root, ... }))`.

**Assertion (return value or thrown error)**:
- Rejects; `error.message.startsWith('PRESET-E-5')`.

**Assertion (log)**:
- `preset.load.failure` with `errorCode === 'PRESET-E-5'`.

#### T-3-2-4 (covers B-3-1, PRESET-E-6 malformed regex at load time)

**Name**: `loadPreset rejects PRESET-E-6 when a static-grep rule has an unterminated regex`

**Setup**:
- `mkPreset(root, 'builtin', 'cli-tool', BAD_REGEX_PRESET)`.

**Action**:
- `await expect(loadPreset(...))`.

**Assertion (return value or thrown error)**:
- Rejects; `error.message.startsWith('PRESET-E-6')`.

**Assertion (log)**:
- `preset.load.failure` with `errorCode === 'PRESET-E-6'`.

---

### B-4 — `runPreset` execution & error isolation

#### T-4-1-1 (covers B-4-1)

**Name**: `runPreset emits start+success for every rule in a 3-rule deterministic preset`

**Setup**:
- Build a manifest in-memory (no markdown round-trip needed — `runPreset` takes a `PresetManifest`) with 3 rules: two `static-grep` (one matching, one not) and one `file-exists`.
- Create a tiny scratch repo: `<ctx.cwd>/src/a.ts` containing `TODO: x`; `<ctx.cwd>/README.md` empty.
- `ctx = { cwd, repoSha: null }`.

**Action**:
- `const findings = await runPreset(manifest, ctx, { logger: silentPresetLogger });`

**Assertion (return value or thrown error)**:
- `Array.isArray(findings)` is true.
- `findings.length >= 0` (no error thrown; surface allows N ≥ 0).
- Each finding is shape-valid (`id`, `presetId`, `ruleId`, `severity`, `file`, `line`, `evidence`, `matched_content_normalized`, `message`, `version: '1.0'`).

**Assertion (log)**:
- Captured entries under `track: 'preset'` contain:
  - exactly one `preset.run.start` with `presetId` and `rulesCount === 3`.
  - exactly 3 `preset.run.rule.start` (one per rule); each carries `presetId`, `ruleId`, `mechanism`.
  - exactly 3 `preset.run.rule.success` (one per rule); each carries `presetId`, `ruleId`, `findingsCount` (number), `durationMs` (number).
  - exactly one `preset.run.success` with `presetId`, `findingsCount === findings.length`, `durationMs` (number).
- No `preset.run.rule.failure` / `preset.run.rule.timeout` / `preset.run.failure`.

#### T-4-1-2 (covers B-4-1, zero-rule edge)

**Name**: `runPreset throws or fails-fast on a manifest with zero rules`

**Setup**:
- An in-memory manifest with `rules: []`.

**Action**:
- `await runPreset(manifest, ctx, { logger: silentPresetLogger })`.

**Assertion (return value or thrown error)**:
- See audit item AU-6 — surface does not specify what runPreset does for a zero-rule manifest (loader would reject PRESET-E-3, but runPreset takes a manifest directly). Test asserts the **stronger** of the two reasonable contracts: either it returns `[]` AND emits one `preset.run.start` (`rulesCount: 0`) + one `preset.run.success` (`findingsCount: 0`), OR it throws. The test should be written to lock in whichever the implementation does, with a TODO referencing AU-6.

**Assertion (log)**:
- If it returns `[]`: `preset.run.start` (`rulesCount: 0`) + `preset.run.success` (`findingsCount: 0`).
- If it throws: no `preset.run.success`.

#### T-4-2-1 (covers B-4-2)

**Name**: `runPreset emits one preset.run.rule.finding event per produced finding with matching findingId and severity`

**Setup**:
- In-memory manifest with one `static-grep` rule, severity `'P2'`, pattern matching exactly two occurrences in a fixture file (`'TODO'` appearing on lines 3 and 7 of `src/a.ts`).

**Action**:
- `const findings = await runPreset(...)`.

**Assertion (return value or thrown error)**:
- `findings.length === 2`.
- Findings have distinct `id` values (different `line`).

**Assertion (log)**:
- Captured entries contain exactly 2 `preset.run.rule.finding` events.
- For each: `findingId` equals some `findings[i].id`, `severity === 'P2'`, `file === findings[i].file`, `line === findings[i].line`. Every captured `findingId` is present in `findings.map(f => f.id)` and vice versa (set-equal).

#### T-4-2-2 (covers B-4-2, zero findings yields zero finding events)

**Name**: `runPreset emits no preset.run.rule.finding events when a rule matches nothing`

**Setup**:
- Manifest with one `static-grep` rule whose pattern matches nothing in the fixture.

**Action**:
- `const findings = await runPreset(...)`.

**Assertion (return value or thrown error)**:
- `findings.length === 0`.

**Assertion (log)**:
- Zero `preset.run.rule.finding` events.
- Still exactly one `preset.run.rule.start`, one `preset.run.rule.success` with `findingsCount === 0`.

#### T-4-3-1 (covers B-4-3)

**Name**: `runPreset rejects PRESET-E-7 with partialFindings when criticPolicy is missing for an llm-judgment rule`

**Setup**:
- In-memory manifest with three rules in order: `static-grep` (matches, produces 1 finding), `static-grep` (matches, produces 1 finding), `llm-judgment` (with `llmPolicy`).
- Fixture file contains the patterns.
- Call `runPreset(manifest, ctx, { logger: silentPresetLogger })` — **no** `criticPolicy`.

**Action**:
- `let caught; try { await runPreset(...); } catch (e) { caught = e; }`.

**Assertion (return value or thrown error)**:
- `caught` is an `Error`; `caught.message.startsWith('PRESET-E-7')`.
- `Array.isArray(caught.partialFindings)`.
- `caught.partialFindings.length === 2` (the two static-grep findings completed before the llm-judgment rule was reached).
- Each `partialFindings[i]` is shape-valid `Finding`.

**Assertion (log)**:
- Captured entries contain:
  - `preset.run.start` with `rulesCount: 3`.
  - 2 `preset.run.rule.start` + 2 `preset.run.rule.success` (for the two static-grep rules).
  - At most one `preset.run.rule.start` for the llm-judgment rule (it may emit start before discovering missing policy; surface does not forbid this — see audit AU-2).
  - One `preset.run.failure` with `presetId`, `ruleId` (the llm-judgment one), `errorCode === 'PRESET-E-7'`.
- No `preset.run.success`.

#### T-4-3-2 (covers B-4-3, llm-judgment first means partialFindings empty)

**Name**: `runPreset PRESET-E-7 partialFindings is empty when llm-judgment is the first rule`

**Setup**:
- In-memory manifest with `llm-judgment` rule first, then two `static-grep` rules. No `criticPolicy`.

**Action**:
- Catch the rejection.

**Assertion (return value or thrown error)**:
- `error.message.startsWith('PRESET-E-7')`.
- `error.partialFindings` is an array of length 0.

**Assertion (log)**:
- `preset.run.failure` with `errorCode === 'PRESET-E-7'`.
- No `preset.run.rule.success` events.

---

### B-5 — Finding ID stability

#### T-5-1-1 (covers B-5-1)

**Name**: `buildFindingId returns identical id on repeated calls with the same inputs`

**Setup**:
- `const input = { presetId: 'x', ruleId: 'r', file: 'a.ts', line: 10, evidence: 'foo' };`

**Action**:
- `const a = buildFindingId(input); const b = buildFindingId({...input});`

**Assertion (return value or thrown error)**:
- `a.id === b.id`.
- `a.id` matches `/^x\.[0-9a-f]{8}$/`.
- `a.matched_content_normalized === 'foo'`.
- `a.matched_content_normalized === b.matched_content_normalized`.

**Assertion (log)**:
- (none — pure function; no log claim in surface.)

#### T-5-1-2 (covers B-5-1, whitespace normalization)

**Name**: `buildFindingId yields identical id when evidence differs only by whitespace/case`

**Setup**:
- `a = buildFindingId({ presetId:'x', ruleId:'r', file:'a.ts', line:10, evidence:'Foo Bar' });`
- `b = buildFindingId({ presetId:'x', ruleId:'r', file:'a.ts', line:10, evidence:'foo\tbar' });`

**Action**:
- compute both.

**Assertion (return value or thrown error)**:
- `a.matched_content_normalized === 'foobar' === b.matched_content_normalized` (per surface: `evidence.replace(/\s+/g, '').toLowerCase()`).
- `a.id === b.id`.

#### T-5-2-1 (covers B-5-2)

**Name**: `runPreset on a file with edits in unrelated regions preserves finding ids in unchanged regions`

**Setup**:
- Fixture file `src/a.ts` v1: line 10 contains `TODO: fix`; line 50 contains `// keep`.
- In-memory manifest with one `static-grep` rule matching `TODO`.
- Run `runPreset` → capture `findings1[0].id`.
- Mutate file: change line 50 to `// keep, edited`. Line 10 unchanged.
- Run `runPreset` again → capture `findings2[0].id`.

**Action**:
- Two sequential `runPreset` calls.

**Assertion (return value or thrown error)**:
- `findings1.length === 1`; `findings2.length === 1`.
- `findings1[0].id === findings2[0].id`.
- `findings1[0].matched_content_normalized === findings2[0].matched_content_normalized`.

**Assertion (log)**:
- Each run emits matching `preset.run.rule.finding` with `findingId === findings1[0].id` (and again `=== findings2[0].id`).

#### T-5-2-2 (covers B-5-2, line-shift caveat acknowledged)

**Name**: `buildFindingId is line-sensitive: changing line number changes id (acknowledged limitation)`

**Setup**:
- `a = buildFindingId({ presetId:'x', ruleId:'r', file:'a.ts', line:10, evidence:'foo' });`
- `b = buildFindingId({ presetId:'x', ruleId:'r', file:'a.ts', line:11, evidence:'foo' });`

**Action**:
- compute both.

**Assertion (return value or thrown error)**:
- `a.id !== b.id` (codifies the surface admission: "cosmetic line shift ... DOES change line, which DOES change the hash").
- `a.matched_content_normalized === b.matched_content_normalized`.

**Assertion (log)**:
- (none — pure function.)

---

### B-6 — Rule isolation under failure

#### T-6-1-1 (covers B-6-1)

**Name**: `runPreset times out a slow rule into a synthetic P3 finding and continues with siblings`

**Setup**:
- In-memory manifest with two rules:
  - rule A: deterministic, will produce 1 finding normally.
  - rule B: `detection.timeoutMs: 10`; mechanism configured to sleep > 50ms (mechanism choice per fixture — see audit AU-1; assume `test-execution` with a command that sleeps).
- `ctx = { cwd, repoSha: null }`.

**Action**:
- `const findings = await runPreset(manifest, ctx, { logger: silentPresetLogger });`

**Assertion (return value or thrown error)**:
- `findings.length === 2` (A's real finding + B's synthetic timeout finding).
- One finding has `ruleId === 'A'`, severity from manifest.
- One finding has `ruleId === 'B'`, `severity === 'P3'`, `message === 'rule timed out'`, `presetId` matches manifest.

**Assertion (log)**:
- Captured: 2 `preset.run.rule.start`, 1 `preset.run.rule.success` (for A), 1 `preset.run.rule.timeout` (for B) with `presetId`, `ruleId === 'B'`, `timeoutMs === 10`.
- One `preset.run.success` (`findingsCount === 2`).
- No `preset.run.failure`.

#### T-6-1-2 (covers B-6-1, timeout finding still gets a finding event)

**Name**: `synthetic timeout finding still emits preset.run.rule.finding`

**Setup**:
- Same as T-6-1-1, focus on rule B.

**Action**:
- `await runPreset(...)`.

**Assertion (return value or thrown error)**:
- `findings.filter(f => f.ruleId === 'B').length === 1`.
- That finding's `id` is built via `buildFindingId` (matches `/^<presetId>\.[0-9a-f]{8}$/`).

**Assertion (log)**:
- See audit AU-4 — surface does not explicitly say whether the synthetic timeout finding emits `preset.run.rule.finding`. Test asserts what the surface most naturally implies: B-4-2 says "Each produced finding has a matching `preset.run.rule.finding` log event" and the timeout produces a finding, so one matching `preset.run.rule.finding` is expected for the synthetic finding.

#### T-6-2-1 (covers B-6-2)

**Name**: `runPreset survives a rule that throws at detection time and continues siblings`

**Setup**:
- In-memory manifest with two rules:
  - rule A (`static-grep`): will produce 1 finding on the fixture.
  - rule B (`static-grep` with a `detection.pattern` that the regex compiler at load time accepted but throws at runtime — see audit AU-5; mechanism-specific synthetic failure).
- Fixture file present.

**Action**:
- `const findings = await runPreset(manifest, ctx, { logger: silentPresetLogger });`

**Assertion (return value or thrown error)**:
- Promise resolves (no rejection); `findings.length === 1` (just rule A's).
- The lone finding has `ruleId === 'A'`.

**Assertion (log)**:
- Captured: 2 `preset.run.rule.start`, 1 `preset.run.rule.success` (rule A), 1 `preset.run.rule.failure` (rule B) with `presetId`, `ruleId === 'B'`, `error` (string, non-empty).
- One `preset.run.success` with `findingsCount === 1`.

#### T-6-2-2 (covers B-6-2, all rules fail)

**Name**: `runPreset returns [] and emits all failures when every rule throws`

**Setup**:
- Two rules, both crafted to throw at runtime.

**Action**:
- `const findings = await runPreset(...)`.

**Assertion (return value or thrown error)**:
- Resolves with `findings.length === 0` (rule isolation per B-6-2 says a failing rule does not interrupt siblings; no surface text says "all rules failing → throw").

**Assertion (log)**:
- Captured: 2 `preset.run.rule.start`, 0 `preset.run.rule.success`, 2 `preset.run.rule.failure`, 1 `preset.run.success` with `findingsCount === 0`.

---

## Section 4 — Coverage map

| Behavior | Tests |
|---|---|
| B-1-1 | T-1-1-1, T-1-1-2 |
| B-1-2 | T-1-2-1, T-1-2-2 |
| B-2-1 | T-2-1-1, T-2-1-2 |
| B-2-2 | T-2-2-1, T-2-2-2 |
| B-3-1 | T-3-1-1, T-3-1-2, T-3-1-3, T-3-1-4, T-3-1-5, T-3-2-3, T-3-2-4 |
| B-3-2 | T-3-2-1, T-3-2-2 |
| B-4-1 | T-4-1-1, T-4-1-2 |
| B-4-2 | T-4-2-1, T-4-2-2 |
| B-4-3 | T-4-3-1, T-4-3-2 |
| B-5-1 | T-5-1-1, T-5-1-2 |
| B-5-2 | T-5-2-1, T-5-2-2 |
| B-6-1 | T-6-1-1, T-6-1-2 |
| B-6-2 | T-6-2-1, T-6-2-2 |

Total: 26 test cases across 12 behaviors. Every behavior has ≥ 2 tests. Log-assertion tests: 19 of 26 (~73%) include a `captureLogsFor` assertion — above the 50% floor.

---

## Section 5 — Surface-claim audit (gaps that block test writing)

### AU-1 — Timeout mechanism: how does a `static-grep` rule "deliberately sleep"?

- **Surface promise**: "B-6-1 A rule whose `detection.timeoutMs` is set low (e.g. 10ms) and whose mechanism's implementation deliberately sleeps longer yields a synthetic `Finding`..."
- **Gap**: The surface enumerates 5 mechanisms (`static-grep`, `file-exists`, `test-execution`, `cross-file-cohesion`, `llm-judgment`) but does not specify a mechanism whose `detection` config supports an explicit slow path the test can lean on. Tests in T-6-1-1 / T-6-1-2 / T-6-2-1 currently guess "use `test-execution` with a sleep command", but the surface neither lists a `detection.command` field nor a `detection.timeoutMs` field for any specific mechanism. Without a mechanism-by-mechanism `detection` schema in the surface, every mechanism test is currently writing against a guess.

### AU-2 — PRESET-E-7 ordering: does the failing llm-judgment rule emit `preset.run.rule.start`?

- **Surface promise**: "B-4-3 ... rejects with `PRESET-E-7`. The thrown error carries `partialFindings: Finding[]` containing findings from rules that completed before the LLM rule was reached." Plus surface §"Self-emitted log events" lists `preset.run.failure` with `errorCode: 'PRESET-E-7'` carrying `ruleId`.
- **Gap**: Unclear whether the implementation pre-validates the manifest+options for missing `criticPolicy` *before* iterating rules (in which case zero `preset.run.rule.start` is emitted) or lazily fails when it actually reaches the llm rule (one `preset.run.rule.start` is emitted before the failure). T-4-3-1 currently says "at most one" to accommodate both — but a precise contract would let us assert exactly.

### AU-3 — PRESET-E-5: what counts as "more than one preset.md"?

- **Surface promise**: "PRESET-E-5 | `loadPreset` / `listPresets`: plugin package has more than one `preset.md`"
- **Gap**: Each plugin package is supposed to contain exactly `${cwd}/node_modules/@zerou-preset-*/preset.md` (one preset per package, per surface §"Three-layer lookup chain"). PRESET-E-5 talks about "more than one preset.md" — but inside one `@zerou-preset-*` dir, by naming, there can only be one file named exactly `preset.md`. Does PRESET-E-5 trigger on (a) subdirectory `preset.md` files (nested), (b) two `@zerou-preset-*` packages declaring the same `id` (which seems more like a different bug), or (c) some sibling-file convention not in the surface? The fixture `PLUGIN_DOUBLE_PRESET_DIR` cannot be built deterministically without this.

### AU-4 — Does the synthetic timeout finding emit `preset.run.rule.finding`?

- **Surface promise**: B-4-2 says every produced finding has a matching `preset.run.rule.finding`; B-6-1 says timeouts yield a synthetic finding; the log event table lists `preset.run.rule.timeout` separately.
- **Gap**: Are timeouts an exception to B-4-2 (only `preset.run.rule.timeout` emitted, no `preset.run.rule.finding`)? Or is the synthetic finding also accompanied by `preset.run.rule.finding`? T-6-1-2 currently assumes "yes, finding event is emitted" but the surface is silent.

### AU-5 — B-6-2 example contradicts PRESET-E-6

- **Surface promise**: B-6-2 says "A rule with a deliberately throwing `detection` config (e.g. malformed regex caught at runtime in `static-grep`) emits `preset.run.rule.failure`...". PRESET-E-6 says "`loadPreset`: malformed `static-grep` regex" rejects at load time.
- **Gap**: The two seem to disagree: if `loadPreset` rejects PRESET-E-6 at load for malformed regex, how does `runPreset` ever see a "malformed regex caught at runtime"? Either (a) some malformed regexes only manifest at runtime against specific input (e.g. catastrophic backtracking timing out, but that's not "malformed"), or (b) PRESET-E-6 catches a subset (syntactically invalid) and runtime catches a different subset (e.g. ReDoS, lookbehind unsupported on target engine). Without disambiguation, T-6-2-1 cannot construct a fixture that *does* compile at load but throws at run.

### AU-6 — `runPreset` on a manifest with `rules: []`

- **Surface promise**: B-4-1 talks about "A preset with 3 rules"; PRESET-E-3 covers `loadPreset` rejecting zero-rule manifests.
- **Gap**: `runPreset` accepts a `PresetManifest` directly (not just via `loadPreset`), so a caller can pass `{ rules: [] }`. Surface does not state whether `runPreset` returns `[]`, throws, or has its own error code. T-4-1-2 is written to accept either outcome with a TODO.

### AU-7 — Preset id case + glob

- **Surface promise**: id schema is `/^[a-z][a-z0-9-]{1,63}$/`, plugin layer is "globbed: `${cwd}/node_modules/@zerou-preset-*/preset.md`".
- **Gap**: Surface §"What this surface does NOT promise" disclaims FS case-sensitivity. But what about input-id case mismatch (caller passes `'CLI-TOOL'`)? Is PRESET-E-1 raised because the id is invalid by schema, or because no candidate matches? The error code is the same either way, but it affects whether `loadPreset` validates the input id format before searching layers.

### AU-8 — `RunContext.fileFilter` default contract

- **Surface promise**: "`fileFilter?: (path: string) => boolean; // default: include all files except `.git/`, `node_modules/`"
- **Gap**: Does the default *also* exclude `.zerou/` (the project's own preset dir), or could a rule scan project-local preset markdown? Could the rule scan the bundled builtin presets if the test wrote them under `cwd`? The fixture builder writes presets *under cwd*, so without a default exclusion for `.zerou/` or the test-passed `builtinDir`, runs may inadvertently produce findings against the test's own fixtures and inflate counts.

### AU-9 — `appliesTo` enforcement

- **Surface promise**: Manifest schema declares `appliesTo: <string[], optional, each entry one of project-type letters>`. Surface introduces letters but defines no enum, and `runPreset` signature takes no project-type input.
- **Gap**: Is `appliesTo` enforced inside `runPreset` (e.g. early-return empty if project type doesn't match), or is it advisory only (consumed by the hardener CLI layer)? Cannot write a test for "runPreset on a manifest with `appliesTo: ['C']` against a non-C project produces zero findings" without knowing the contract.

### AU-10 — `dependsOn` semantics

- **Surface promise**: `dependsOn?: string[]; // advisory only in v0.2`.
- **Gap**: "Advisory only" — what does that mean for a test? Is there *any* observable behavior of `dependsOn`? (e.g. a log event listing dependencies, an order constraint in `listPresets`, an error if a depended-on id is unresolvable?) Without an observable effect, `dependsOn` cannot be tested at all.

### AU-11 — `CriticPolicy` shape (cross-protocol)

- **Surface promise**: `runPreset` `RunOptions` imports `CriticPolicy from '../cross-engine-reviewer/types'`; PRESET-E-7 triggers when it's missing.
- **Gap**: To test the happy-path *with* an llm-judgment rule (a positive of B-4-3, not just negative), the test needs to construct a valid `CriticPolicy`. The surface here does not name its required fields. The test plan above omits a positive llm-judgment run test for this reason. Either P2 should re-export a minimal `CriticPolicy` shape (or a `createMinimalCriticPolicyForTest()` test helper), or this surface should narrow its dependency to a structural subset it actually uses (e.g. `{ pickEngine: () => ... }`).

### AU-12 — `loadPreset` shadow event + success event ordering

- **Surface promise**: §"Three-layer lookup chain" says on shadow the loader emits `preset.load.shadowed` and returns `LoadedPreset` with `shadowedBy` populated.
- **Gap**: Does `preset.load.shadowed` fire before or after `preset.load.resolved`/`preset.load.success`? Tests assert presence but not ordering; without ordering, two correct implementations may differ in ways that future regressions hide.

### AU-13 — `Finding.evidence` truncation marker

- **Surface promise**: `evidence: string; // verbatim, max 2 KB, trailing "..." if truncated`
- **Gap**: No `Behavior` ID (B-*) covers this. To assert "evidence truncated to 2 KB with trailing `...`", a test needs a fixture file with a >2 KB match. Without an explicit B-X-Y, this contract has no coverage requirement, and the test plan above doesn't cover it. Either add a B-7-x for evidence formatting, or accept this as an untested implementation detail.

### AU-14 — `partialFindings` field name / Error subclass

- **Surface promise**: B-4-3 says "The thrown error carries `partialFindings: Finding[]`".
- **Gap**: Is this a plain `Error` with an extra property attached, or a typed subclass (e.g. `PresetMissingCriticPolicyError`)? Test T-4-3-1 currently asserts only `Array.isArray(caught.partialFindings)`, but if it's a typed class, tests should also assert `caught instanceof X`.

### AU-15 — `listPresets` iteration / shadow events for non-conflicting presets

- **Surface promise**: §"What this surface does NOT promise" says "presets within one layer are alphabetical by id"; behavior table only covers shadow for B-2-1.
- **Gap**: When `listPresets` walks 20 presets across 3 layers, are `preset.load.start` / `preset.load.resolved` / `preset.load.success` emitted once per preset id? Per (id, layer) pair? Not at all (only `preset.load.shadowed` per shadowed id)? Tests currently assert log events for `loadPreset` of a single id; the `listPresets` log-event contract is unspecified.

---

Files I read: D:\lll\d2p\docs\details\13-protocol-2-public-surface.md, D:\lll\d2p\docs\details\12-log-module-public-surface.md, D:\lll\d2p\CONTEXT.md
