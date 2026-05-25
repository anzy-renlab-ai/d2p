# 13 — Protocol-2 Preset Framework Comparison Report

> SPEC-SPLIT step 4: compare spec, surface, and tests. Three gap classes:
>
> - **(A)** spec promised, test/Behavior table didn't cover
> - **(B)** test author assumed something the surface didn't expose
> - **(C)** spec and surface disagree (or surface is internally inconsistent)

Subagent attestation: `Files I read: D:\lll\d2p\docs\details\13-protocol-2-public-surface.md, D:\lll\d2p\docs\details\12-log-module-public-surface.md, D:\lll\d2p\CONTEXT.md` — read constraint observed; spec was not opened.

Test doc coverage: 26 test cases across 12 Behavior IDs (2+ per ID). 19/26 (73%) cases carry `Assertion (log)` blocks. Coverage map complete.

---

## Gap inventory

### Gap C1 — PRESET-E-6 (load-time malformed regex) contradicts B-6-2 (runtime malformed regex)

**Where**: Surface §"Error codes" PRESET-E-6 says `loadPreset` rejects malformed regex at load. Surface §"Behavior contract" B-6-2 says "A rule with a deliberately throwing `detection` config (e.g. malformed regex caught at runtime in `static-grep`) emits `preset.run.rule.failure`".

**Subagent observation** (AU-5): "if `loadPreset` rejects PRESET-E-6 at load for malformed regex, how does `runPreset` ever see a 'malformed regex caught at runtime'?"

**Class**: (C) — internally inconsistent.

**Resolution**: spec + surface MUST disambiguate. Concrete split:
- PRESET-E-6 covers **syntactically invalid** regexes — caught at construction (`new RegExp(...)` throws at load).
- B-6-2 covers **runtime failures** that aren't malformed-syntax — examples: catastrophic backtracking exceeding a per-pattern internal time-budget, ReDoS guard tripping, or an unsupported regex feature on the running engine. Update B-6-2 example from "malformed regex" to "regex with catastrophic backtracking on adversarial input" (or similar).

---

### Gap C2 — PRESET-E-5 trigger condition internally inconsistent with "one preset.md per package"

**Where**: Surface §"Three-layer lookup chain" says plugin layer is "globbed: `${cwd}/node_modules/@zerou-preset-*/preset.md` (one preset per package)". Surface §"Error codes" PRESET-E-5: "plugin package has more than one `preset.md`".

**Subagent observation** (AU-3): inside one `@zerou-preset-*` dir, the filesystem cannot have two files named `preset.md` at the same path. Either subdir-nested `preset.md` files count, or the rule is about something else.

**Class**: (C) — internally inconsistent.

**Resolution**: spec + surface MUST clarify. Concrete: PRESET-E-5 triggers when the **`--full-depth`-like recursive scan** of a single `@zerou-preset-*` package directory finds more than one `preset.md` (e.g. one at root, one in a `bundled-extras/` subdir). Surface should add: "Within one plugin package, only the `preset.md` at the package root is the canonical entry; any additional `preset.md` files at deeper paths trigger PRESET-E-5." This matches the surface's "one preset per package" promise.

Alternative: PRESET-E-5 covers two distinct `@zerou-preset-*` packages declaring the same preset `id` (a different conflict). Pick one and document it.

I choose option 1 (root-vs-deeper preset.md collision) because it matches the "one preset per package" framing.

---

### Gap A1 — `Finding.evidence` 2KB truncation has no `B-X-Y` coverage

**Where**: Surface declares `evidence: string; // verbatim, max 2 KB, trailing "..." if truncated`. No Behavior covers this.

**Subagent observation** (AU-13): tests cannot be required to cover this without an explicit B-X-Y.

**Class**: (A) — spec promised (in surface), behavior contract incomplete.

**Resolution**: add `B-7-1` ("evidence under 2 KB is preserved verbatim") and `B-7-2` ("evidence over 2 KB is truncated to 2 KB with trailing `...`"). Update spec §7 Behaviors and surface "Behavior contract" + reverse lookup.

---

### Gap B1 — Per-mechanism `detection` config schema absent

**Where**: Surface lists 5 mechanisms but doesn't enumerate the `detection` shape for each.

**Subagent observation** (AU-1): "every mechanism test is currently writing against a guess." Blocks tests T-6-1-1, T-6-1-2, T-6-2-1 from being deterministic.

**Class**: (B) — surface gap.

**Resolution**: surface MUST enumerate per-mechanism detection shape (treat as part of the v0.2 manifest contract):

```typescript
type StaticGrepDetection = {
  pattern: string;                 // RegExp source string (constructor: new RegExp(pattern))
  flags?: string;                  // 'i', 'g', etc.
  filePattern?: string;            // glob limiting which files to scan; default: all
  timeoutMs?: number;              // per-rule timeout, default 60_000
};

type FileExistsDetection = {
  paths: string[];                 // repo-relative paths to check
  expect: 'present' | 'absent';
  timeoutMs?: number;
};

type TestExecutionDetection = {
  command: string;
  args?: string[];
  failOn: 'exitCode' | 'stderrPattern';
  stderrPattern?: string;          // required when failOn === 'stderrPattern'
  timeoutMs?: number;
};

type CrossFileCohesionDetection = {
  analyzer: 'env-vs-env-example' | 'package-json-vs-lock';
  config?: Record<string, unknown>;
  timeoutMs?: number;
};

type LlmJudgmentDetection = {
  prompt: string;                  // template; supports {{file}}, {{line}}, {{evidence}} substitutions
  filePattern?: string;
  // llmPolicy lives on the rule, not in detection
};
```

Add to surface under "Manifest schema" section. Adds ~30 lines but closes the biggest deterministic-testing gap.

---

### Gap B2 — `CriticPolicy` shape too opaque for positive llm-judgment tests

**Subagent observation** (AU-11): "the test plan above omits a positive llm-judgment run test for this reason."

**Class**: (B) — surface gap. P2's surface imports `CriticPolicy` from P1's surface; P1's surface defines `CriticPolicy` but the field that matters for P2 (`criticEngine: LLMEngine`) is what P2 needs to mock for a positive test.

**Resolution**: no change in P2 surface; P1 surface already exposes `LLMEngine` via re-export-through-types. Add a note in P2 surface dependency block: "For unit tests of `runPreset` that exercise `llm-judgment` rules, construct a `CriticPolicy` per Protocol-1's surface (§Core types) with a mock `LLMEngine` whose `callJson(prompt, opts)` returns a value matching the rule's expected schema. The mock engine implements only the `LLMEngine` interface — no real network."

This is a documentation fix, not a surface shape change.

---

### Gap B3 — `runPreset` on `rules: []` unspecified

**Subagent observation** (AU-6): caller can pass a manifest with empty rules; behavior is undefined.

**Class**: (B) — surface gap.

**Resolution**: spec + surface MUST specify: `runPreset` on a manifest with `rules: []` returns `[]` (no error) and emits `preset.run.start { rulesCount: 0 }` + `preset.run.success { findingsCount: 0 }`. Justification: `loadPreset` already rejects zero-rule manifests via PRESET-E-3, so the only path to this state is a programmatic caller constructing a manifest manually — and "no rules → no findings" is the only consistent behavior.

Add as B-7-3 (alongside the evidence ones).

---

### Gap B4 — Synthetic timeout finding: does `preset.run.rule.finding` fire?

**Subagent observation** (AU-4): B-4-2 says "every produced finding has a matching `preset.run.rule.finding`", but timeouts have a dedicated `preset.run.rule.timeout` event.

**Class**: (B) — surface gap.

**Resolution**: spec + surface MUST decide. Pick: **yes, the synthetic finding DOES emit `preset.run.rule.finding`**. The contract is "every Finding in the returned array has a `preset.run.rule.finding` event"; the timeout case fits because it does produce a Finding. The `preset.run.rule.timeout` event is additional, not a substitute. Update B-4-2 wording and add a sentence to surface "Self-emitted log events" under `preset.run.rule.finding`: "Emitted for every Finding, including synthetic findings from timeouts and other failures that yield a Finding."

---

### Gap B5 — PRESET-E-7 ordering: does the failing rule emit `preset.run.rule.start`?

**Subagent observation** (AU-2): T-4-3-1 says "at most one" `preset.run.rule.start` for the llm rule.

**Class**: (B) — surface gap.

**Resolution**: surface MUST decide. Pick: **`preset.run.rule.start` IS emitted** for the failing rule (then `preset.run.failure` follows). Justification: `runPreset` iterates rules and dispatches; missing `criticPolicy` is a dispatch-time discovery for that specific rule, not a pre-iteration validation. Tighten T-4-3-1 to assert exactly 3 `preset.run.rule.start` events (one per rule) with 2 `preset.run.rule.success` (for completed) + 1 `preset.run.failure` (for the llm rule).

Alternative: implementation pre-checks all rule dependencies before iterating. Then no `preset.run.rule.start` for the failing rule. Surface should pick one; I pick "lazy dispatch" because it's simpler and matches the "rules are independent" framing.

---

### Gap B6 — `appliesTo` enforcement contract

**Subagent observation** (AU-9): "Is `appliesTo` enforced inside `runPreset`?"

**Class**: (B) — surface gap.

**Resolution**: surface MUST decide. Pick: **`appliesTo` is advisory; `runPreset` does NOT filter on it**. Filtering happens at the hardener CLI layer (Track A) when it decides which presets to load for a given project type. Add to surface §"Manifest schema (v0.2 frontmatter)": "`appliesTo` is consumed by upstream callers (hardener CLI) when selecting which presets to run. `runPreset` does not check `appliesTo` against any project-type input."

---

### Gap B7 — `dependsOn` has no observable behavior

**Subagent observation** (AU-10): "advisory only" — what does that mean for a test?

**Class**: (B) — surface gap, but acceptable.

**Resolution**: surface MUST state: "`dependsOn` in v0.2 is metadata only; it has no observable runtime effect. `loadPreset` does not validate that depended-on ids resolve. `runPreset` does not order or skip rules based on it. The field is reserved for v0.3+ when a dependency resolver may be added." This makes "no test required" explicit.

---

### Gap B8 — `RunContext.fileFilter` default exclusion list

**Subagent observation** (AU-8): "Does the default *also* exclude `.zerou/`?"

**Class**: (B) — surface gap.

**Resolution**: surface MUST specify the default exclusion list verbatim:

```
default fileFilter excludes (case-sensitive on POSIX, case-insensitive on Windows):
  .git/, node_modules/, .zerou/, dist/, build/, .next/, .turbo/, .nuxt/, coverage/, __pycache__/
```

Add to surface under entry-point `runPreset`'s `RunContext.fileFilter` documentation.

---

### Gap B9 — Preset id input validation order

**Subagent observation** (AU-7): does `loadPreset('CLI-TOOL', ...)` throw because input invalid or because no match?

**Class**: (B) — surface gap.

**Resolution**: surface MUST specify: "`loadPreset` validates the input `id` against the schema `/^[a-z][a-z0-9-]{1,63}$/` BEFORE searching layers. An invalid input id throws PRESET-E-2 (manifest-schema-style error, applied to the input). This is independent of filesystem case-sensitivity." Make PRESET-E-2's surface description include this case.

---

### Gap B10 — `partialFindings` error type

**Subagent observation** (AU-14): is the thrown error a plain Error with a property, or a typed subclass?

**Class**: (B) — surface gap.

**Resolution**: surface MUST specify: "PRESET-E-7 throws a `PresetMissingCriticPolicyError extends Error` with `name === 'PresetMissingCriticPolicyError'`, `code === 'PRESET-E-7'`, and `partialFindings: Finding[]`." Add an `Error class exports` subsection to surface. Other PRESET-E-* codes throw `PresetError` with the corresponding `code`.

---

### Gap B11 — Shadow event ordering relative to resolved/success

**Subagent observation** (AU-12): unclear ordering.

**Class**: (B) — surface gap.

**Resolution**: surface MUST specify order: `preset.load.start` → `preset.load.shadowed` (if applicable) → `preset.load.resolved` → `preset.load.success`. Document this as a per-id event sequence in surface.

---

### Gap B12 — `listPresets` log-event contract

**Subagent observation** (AU-15): "the `listPresets` log-event contract is unspecified."

**Class**: (B) — surface gap.

**Resolution**: surface MUST specify: "`listPresets` emits per-id sequences identical to `loadPreset` (start → resolved → success, with shadow events where applicable), plus a single `preset.list.start { layersScanned: string[] }` at the beginning and `preset.list.success { count: number }` at the end." Add two new event names to surface "Self-emitted log events" table.

---

## No additional Type-A gaps

All 12 spec Behavior IDs (B-1-1 through B-6-2) have test coverage. Adding B-7-1 / B-7-2 / B-7-3 closes the new gaps.

---

## Summary

| Class | Count |
|---|---|
| (A) spec promised, behavior table incomplete | 1 (evidence truncation B-X-Y missing) |
| (B) test assumed, surface didn't expose | 10 |
| (C) spec/surface internally inconsistent | 2 (PRESET-E-6 vs B-6-2; PRESET-E-5 trigger condition) |

**Total gaps**: 13.

**Fix policy**: all gaps closed in spec + surface before Phase 1 commit. Test doc updated where it currently accepts "either-or" wording (T-4-1-2, T-4-3-1, T-6-1-2, T-6-2-1, T-1-2-2) to lock in the now-decided answer.

Fixes are applied in the same commit as this report.

---

**Status**: Resolutions inlined to surface @ `5eee600` on 2026-05-25. Surface file is now the standalone authoritative contract; this report is historical record only.
