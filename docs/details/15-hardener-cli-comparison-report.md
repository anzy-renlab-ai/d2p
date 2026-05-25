# 15 — Hardener CLI Comparison Report

> SPEC-SPLIT step 4: spec vs surface vs tests. Three gap classes:
>
> - **(A)** spec promised, test/Behavior table didn't cover
> - **(B)** test assumed, surface didn't expose
> - **(C)** spec and surface disagree

Subagent attestation: `Files I read: D:\lll\d2p\docs\details\15-hardener-cli-public-surface.md, D:\lll\d2p\CONTEXT.md, D:\lll\d2p\docs\details\12-log-module-public-surface.md, D:\lll\d2p\docs\details\13-protocol-2-public-surface.md, D:\lll\d2p\docs\details\14-protocol-1-public-surface.md` — read constraint observed; spec was not opened.

Test doc coverage: 33 test cases across 15 documented Behaviors plus 4 bonus tests (legacy `~/.d2p/` fallback, `--help`, `--version`). 28/33 (85%) cases carry log assertions. Coverage map shows every B-ID covered with ≥2 tests except B-1-3 and B-1-1 with single-test justifications recorded.

---

## Gap inventory

### Gap A1 — Legacy `~/.d2p/` fallback has no Behavior ID

**Where**: Spec §4.10 + surface §"Config file" both describe the fallback. No `B-X-Y` in spec §7 or surface §"Behavior contract" pins it.

**Subagent observation** (§3 + Coverage Map note): "The public surface lists this log event but doesn't carve out a `B-X-Y` ID for it."

**Class**: (A) — spec promised, behavior contract missing.

**Resolution**: add `B-10-1` ("legacy `~/.d2p/` fallback fires when `~/.zerou/` absent and `~/.d2p/` exists") and `B-10-2` ("`~/.zerou/` takes precedence when both exist; no legacy log event"). Both in spec + surface.

---

### Gap A2 — `cli.config.invalid` (A-E-3) has no Behavior ID

**Where**: spec + surface define A-E-3 + `cli.config.invalid` event but no `B-X-Y`.

**Subagent observation** (§12): suggested `T-CFG-INVALID-1`.

**Class**: (A) — spec promised, behavior contract missing.

**Resolution**: add `B-10-3` ("invalid config file triggers A-E-3, exits 3, emits `cli.config.invalid`").

---

### Gap A3 — `apply.skip-no-proposal` log event has no bundle counter

**Where**: surface lists `cli.apply.skip-no-proposal` event but the bundle's `apply` object only counts `templateApplied`, `llmVerifiedApplied`, `llmUnverifiedSkipped`. No `skipNoProposal` counter.

**Subagent observation** (§13): "is there a `apply.skipNoProposal: number` field on the bundle?"

**Class**: (A) — surface promises an event for a path not represented in the bundle counters.

**Resolution**: add `apply.skipNoProposal: number` field to spec §4.6 + surface §"EvidenceBundle JSON output" `apply` block. Add `B-10-4` ("a confirmed finding whose `proposeFix` returns `null` (no proposal) emits `cli.apply.skip-no-proposal` AND increments `bundle.apply.skipNoProposal`").

---

### Gap A4 — `byPreset` map not spot-checked in tests

**Where**: surface §"Stdout report" + bundle schema include `byPreset` aggregation; no behavior asserts the per-preset breakdown.

**Subagent observation** (§10): "adding a test that asserts `byPreset` keys match the preset ids and counts sum to the top-level `counts` would tighten coverage."

**Class**: (A) — spec promised, no Behavior carved out.

**Resolution**: add `B-10-5` ("EvidenceBundle.summary.byPreset has one key per preset that produced any finding; per-preset counts sum to top-level counts").

---

### Gap B1 — Nudge wording: `<workerKind>` is kind or family?

**Subagent observation** (§1): "is `<workerKind>` the raw `EngineConfig.kind` string (e.g. `anthropic-api`) or the family (`anthropic`)?"

**Class**: (B) — surface ambiguity.

**Resolution**: surface MUST decide. Pick: **`<workerKind>` is the family** (e.g. `anthropic`), because the nudge tells the user to configure an engine of a *different family*; family names are what `engineFamily()` returns and the user should match against. Update surface §"Stdout report" → "Summary section" to specify the regex form: `/^configure a second engine \(different family from <family-name>\) to verdict the remaining \d+\.$/m` where `<family-name>` is the result of `engineFamily(workerConfig)`.

---

### Gap B2 — `mock-*` engine kinds not in Protocol-1 family taxonomy

**Subagent observation** (§7): tests need a way to register test-only engine kinds; surface doesn't document this.

**Class**: (B) — surface gap (cross-protocol).

**Resolution**: P1 surface (already addressed in P1 comparison Gap B1/B2): tests use real `claude-cli` / `codex-cli` etc. kinds and mock at the engine factory layer. Hardener CLI test doc updates: change `mock-anthropic` → `claude-cli` (or `anthropic-api`) and `mock-openai` → `codex-cli` throughout test fixtures. The "mock" lives at the factory layer (vitest module mock), not the engine kind. Document this convention in surface §"Behavior contract" intro: "tests using `runCli` SHOULD use real `EngineConfig.kind` values and mock at `core/engines/factory.createEngine`; family classification then matches production."

---

### Gap B3 — `--insecure-config` on Windows behavior

**Subagent observation** (§4): "the surface does NOT say whether the flag is silently accepted or whether it emits a warning."

**Class**: (B) — surface gap.

**Resolution**: surface MUST state: "`--insecure-config` on Windows is silently accepted; no warning is emitted (the perm check it bypasses is itself a no-op on Windows)." Add to surface §"Options" table footnote for `--insecure-config`.

---

### Gap B4 — `<path>` is a file vs is a directory

**Subagent observation** (T-2-1-2 commentary): "Surface does not specify a distinct 'is-a-file' event; A-E-1 covers '<path> does not exist [as a directory]'."

**Class**: (B) — surface gap.

**Resolution**: surface MUST state: "`<path>` MUST be a directory. A path that exists but is a regular file is treated as A-E-1 (`cli.path.missing`). No distinct event is emitted." Add to surface §"Error codes" A-E-1 row: "Triggered when `<path>` does not exist OR is not a directory."

---

### Gap B5 — `cli.fatal` (A-E-8) untestable

**Subagent observation** (§11): "the only repeatable way to induce A-E-8 is to inject a programming bug."

**Class**: (B) — surface gap (acceptable as documented).

**Resolution**: surface MUST acknowledge: "A-E-8 (`cli.fatal`) is a defensive catch-all for uncaught exceptions. It is not testable from the public surface because by definition it covers situations the surface does not promise will happen. Tests SHOULD NOT assert on `cli.fatal`. Implementations MAY expose internal hooks for testing this path; those hooks are not part of the public surface."

---

### Gap B6 — A-E-7 (PRESET-E-7 from runPreset) structurally unreachable from CLI

**Subagent observation** (§9): "the CLI always builds a `criticPolicy` (`cli.policy` event is unconditional). So A-E-7 is structurally unreachable from the CLI."

**Class**: (B) — surface inconsistency: spec lists A-E-7 but CLI's flow guarantees `criticPolicy` is always built.

**Resolution**: surface MUST clarify. Two options:

1. Mark A-E-7 as "defensive — should not trigger from CLI by construction" and accept it as untested (parallel to A-E-8).
2. Remove A-E-7 from the surface entirely; let the CLI's `cli.policy` event guarantee `criticPolicy` is always set before any `runPreset` call.

Pick option 1 (keep defensive, document as untestable). Update surface §"Error codes" A-E-7: "Defensive only. The CLI always passes a `criticPolicy` to `runPreset`; A-E-7 cannot fire under normal flow. If it does, treat as an internal invariant violation; reraise with `cli.fatal`."

---

### Gap B7 — `--apply` + all-skipped + `--fail-on p1` exit-code reading

**Subagent observation** (§2 secondary): "when `--apply` is set AND every confirmed finding has only an `llm-only` proposal AND every proposal returns `verified: false`, what's the exit code?"

**Class**: (B) — surface clarification (already technically clear, but worth stating).

**Resolution**: surface MUST add an example to §"Exit codes": "`--fail-on p1` + confirmed P1 finding + `--apply` where all proposals are unverified-and-skipped → exit 2. The threshold is computed BEFORE `--apply` is considered; whether the fix actually applied does not affect the exit code." Add `B-10-6` to test this explicitly.

---

### Gap B8 — Bundle `inputFiles[]` `path` format

**Subagent observation** (T-7-3-1 assumes repo-relative POSIX): not explicitly stated.

**Class**: (B) — surface gap.

**Resolution**: surface MUST state: "`bundle.inputFiles[].path` is repo-relative POSIX (forward slashes), matching `Finding.file`. Absolute paths are NOT used." Add to surface "EvidenceBundle JSON output" `inputFiles` description.

---

### Gap B9 — Stdout summary line regex pinning

**Subagent observation** (T-4-2-1 / T-7-1-1 assume regex format): surface gives format but not regex.

**Class**: (B) — surface clarification.

**Resolution**: surface MUST give the exact regex for both lines:

```
^Of (\d+) findings: (\d+) confirmed / (\d+) false-positive / (\d+) needs-context / (\d+) critic-unavailable$
^configure a second engine \(different family from ([a-z0-9.:-]+)\) to verdict the remaining (\d+)\.$
```

Add to surface §"Stdout report" → "Summary section". Tests assert against these.

---

## Summary

| Class | Count |
|---|---|
| (A) | 4 (legacy fallback B-ID; invalid-config B-ID; skipNoProposal counter+B-ID; byPreset B-ID) |
| (B) | 9 |
| (C) | 0 |

**Total gaps**: 13.

**Fix policy**: all closed in spec + surface before Phase 1 commit. Test doc updated:
- `mock-anthropic` / `mock-openai` → `claude-cli` / `codex-cli` (with vitest factory mock noted)
- `T-CFG-LEGACY-*` renamed `T-10-1-1` / `T-10-2-1` and folded into Coverage map under new B-10-1 / B-10-2
- Add `T-10-3-1` for invalid config (B-10-3)
- Add `T-10-4-1` for skip-no-proposal counter (B-10-4)
- Add `T-10-5-1` for byPreset breakdown (B-10-5)
- Add `T-10-6-1` for apply + fail-on-p1 + all-skipped exit code (B-10-6)
- Remove the audit-flagging notation now that gaps are closed

Fixes are applied in the same commit as this report.

---

**Status**: Resolutions inlined to surface @ `5eee600` on 2026-05-25. Surface file is now the standalone authoritative contract; this report is historical record only.
