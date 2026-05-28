# Phase 9 Lite — Adversarial Judge + Red-Team Generator

> Avoid LLM self-grading circularity in the Phase 5/8 spec evaluation loop.
> Two prompt rewrites (judge + generator) flip the framing from "be helpful"
> to "assume buggy, prove the bug isn't there".

---

## Goal

Phase 5 and Phase 8 wired up a generator → emitter → runner → judge pipeline,
but the judge was a polite reviewer who tended to confirm whatever framing the
generator handed it (`spec.id`, `spec.category`, `spec.reasoning` all leaked).
And the generator itself biased toward happy-path specs — so even an honest
judge would mostly see "validate happy path" assertions.

Phase 9 Lite ships two small prompt changes that break the circularity without
introducing a second engine or a new module:

1. **Adversarial judge** (Lite-1, commit `e724d01`). System prompt casts the
   judge as a skeptical reviewer: "default verdict = fail; pass only if you
   can quote the proving code line." Information isolation: the user prompt
   no longer includes `spec.id`, `spec.category`, or `spec.reasoning`. The
   judge sees only `given/when/then` plus the raw code window.
2. **Red-team generator** (Lite-2, commit `5a916f3`). System prompt flips the
   generator from "senior test engineer" to "red-team auditor". The user
   prompt enumerates a 10-item attack-surface checklist (input boundary,
   validation gaps, auth bypass, data exposure, storage hygiene, error
   handling, concurrency, resource, trust boundary, +1 happy path).

The goal is broader attack-surface coverage from the generator paired with
independent reasoning from the judge — same modules, same cost envelope,
strictly better signal.

## Non-Goals

- ❌ No cross-engine judge yet (stays MiniMax-only by design)
- ❌ No prompt-chaining, no multi-pass refinement
- ❌ No real adversarial generator (we don't yet feed live code back into
  the generator to find counterexamples — that's a future "fuzzing" track)
- ❌ No retraining; this is pure prompt engineering on top of existing
  `agent/test-spec-runner.ts` + `agent/test-case-generator.ts`

## Architecture

```
test-case-generator.ts          test-spec-runner.ts
────────────────────────        ─────────────────────
SPEC_SYSTEM_PROMPT              SYSTEM_PROMPT
  "red-team auditor"              "default verdict = fail"
  + 10-item attack-surface         + "pass only if you can quote"

buildSpecPrompt(target)         buildJudgePrompt(spec, code)
  → includes attack-surface       → strips spec.id / category / reasoning
  → demands ≥1 spec per item      → sees only given/when/then + code
```

No new files. Both modules already exist; only the prompt strings change.

## Module Contracts

**`agent/test-spec-runner.ts`**

- `SYSTEM_PROMPT` MUST contain the strings `default verdict` and
  `quote the proving code line` (locked by contract test).
- `buildJudgePrompt(spec, codeWindow)` MUST NOT emit `spec.id`,
  `spec.category`, or `spec.reasoning` into the prompt body (locked by
  contract test that asserts absence of these keys in the rendered string).
- Output verdict shape unchanged: `'pass' | 'fail' | 'inconclusive'`.

**`agent/test-case-generator.ts`**

- `SPEC_SYSTEM_PROMPT` MUST contain `red-team` and `presumed-buggy`
  (locked by contract test).
- `buildSpecPrompt(target)` MUST enumerate the 10-item attack-surface
  checklist verbatim.
- Output `TestCaseSpec[]` shape unchanged.

## Acceptance Checklist

1. Generator and judge prompts updated; all existing call sites unchanged.
2. Existing test-spec-runner + test-case-generator suites continue to pass.
3. `npx vitest run` shows +2 contract tests for Lite-1 and +2 for Lite-2.
4. Not doing: cross-engine reviewer, generator-judge feedback loop, eval harness.
5. Done when contract tests pin the framing and dogfood on `phase5-demo`
   shows generator-emitted specs include SQL-injection / auth-bypass
   entries instead of pure "validates email format".

## How To Verify

```bash
cd D:/lll/d2p
npx vitest run cli/src/agent/test-spec-runner.test.ts
npx vitest run cli/src/agent/test-case-generator.test.ts

# Empirical (requires MiniMax key):
node cli/bin/zerou.mjs audit /tmp/phase5-demo --config /tmp/zerou-minimax-cfg.json
grep -E "sql.injection|auth.bypass|sql-inj" /tmp/phase5-demo/.zerou/test-specs.json
```

## Implementation

- Worker dispatch: single sonnet worker per Lite slice (no parallelism needed).
- Files touched:
  - `cli/src/agent/test-spec-runner.ts` (+41 LOC / -19 LOC)
  - `cli/src/agent/test-spec-runner.test.ts` (+73 LOC)
  - `cli/src/agent/test-case-generator.ts` (prompt rewrites)
  - `cli/src/agent/test-case-generator.test.ts` (+2 contract tests)

## Status

```
Shipped: e724d01 (Lite-1 judge), 5a916f3 (Lite-2 generator)
Tests: cli 221 → 223 (Lite-1) → 225 (Lite-2)  0 regression
Dogfood: phase5-demo — generator shifted from happy-path to attack-surface
```
