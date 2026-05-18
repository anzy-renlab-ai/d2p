# Track C — Feature Roadmap (research-synthesized)

**Date**: 2026-05-13
**Status**: proposed — pending user green-light
**UI direction**: locked to Track C Mission Control

## What this is

Three research agents surveyed:
1. Anthropic's public guidance for autonomous coding agents (Skills, Agent SDK, prompt caching, Claude Code hooks).
2. Industry leaders (Devin, Cursor 2.0, OpenHands, Aider, SWE-agent, Cline, Replit Agent, Goose, smol-developer).
3. Production-readiness frameworks (12-Factor, OWASP Top 10:2025, Google SRE, WCAG 2.2 AA, OpenSSF Scorecard, per-target conformance gates).

Convergent findings boil down to **six features** that (a) directly reinforce d2p's hands-off + reviewer-trust positioning, (b) fit Track C's gauge/multi-panel/event-stream UI, and (c) don't bloat scope.

Each feature below has a DUCKPLAN block (Plan / Expected Outputs / How To Verify / Probes).

---

## Priority legend

- **MUST**: directly validates a d2p positioning promise. If you cut this, the pitch breaks.
- **SHOULD**: table-stakes credibility once you spend real LLM tokens.
- **NICE**: improves quality / cost but the pitch survives without it.

---

## F1 · Cross-engine critic (FORCED)  · MUST

**One-line**: reviewer agents (alignment / behavioral / adversarial) must run on a **different engine family** than the worker that produced the candidate.

**Why**: OpenHands' Critic Model reached SWE-bench 66.4% specifically because it decorrelates bias from the actor. Same-model self-review converges on the same blind spots — Devin and Replit's documented "fixates on irrelevant root cause" failures share this pattern. d2p's pitch is "trust reviewers, not human diff approval"; that pitch is hollow if actor and reviewer share priors.

**Plan**:
- Add `enginePolicy` field to gap-pipeline config: `{ worker: any, critic: 'different-family' }`.
- New router in `daemon/src/engines/router.ts` that picks the critic engine: if worker was `claude-cli`, route critic to the next configured non-claude family (openai-compat MiniMax / Z.ai / anthropic-api skips because same family).
- If only one family is configured, log a warning but proceed with same-engine (degraded mode); surface in UI as "cross-engine: off" badge.

**Expected Outputs**:
- `daemon/src/engines/router.ts` + unit tests.
- Reviewer events include `criticEngine` + `crossFamily: boolean` fields.
- UI badge in reviewer card: `worker: minimax · critic: claude`.

**How To Verify**:
- Unit test: given worker engine X, router picks engine of different family from configured pool.
- E2E with two fake engines configured (claude-cli + openai-compat shim): assert reviewer call uses the non-worker engine.
- Mission Control screenshot: critic-engine badge visible on reviewer cards.

**Probes**: haiku JSON probe — given two engine configs and a worker assignment, output the critic engine selection. Cross-check against actual router output byte-identical (`jq -S`).

**Source**: Agent 2 report, OpenHands paper (arXiv 2407.16741), Blackbox Chairman pattern.

---

## F2 · Refreshed 32-item preset + mechanism tags · MUST

**One-line**: replace ad-hoc preset items with a deduplicated 32-item checklist drawn from 12-Factor / OWASP / SRE / WCAG / OpenSSF; tag each item with its verification mechanism so the right reviewer runs the right check.

**Why**: d2p's "double-green stop" promise is only as strong as the preset. Current preset items are intuition-derived; the refreshed list is grounded in industry standards and pre-categorized by mechanism (static-grep / file-exists / test-execution / cross-file-cohesion / LLM-judgment) so the **static gate** stops getting asked to make LLM-judgment calls and vice versa. Agent 3 also called out 8 items that LOOK static but actually need the alignment reviewer (auth-on-mutating-routes, env-example completeness, etc.) — getting this routing right cuts both false positives and false negatives.

**Plan**:
- Rewrite `daemon/presets/*.yaml` per project type with the 32-item core list, filtered by `appliesTo` (W/A/C/L/S/M/D/ML).
- Add `mechanism` field per item: one of `static-grep | file-exists | test-execution | cross-file-cohesion | llm-judgment`.
- Static gate reviewer (`daemon/src/agents/static-gate.ts`) reads only `mechanism: static-grep|file-exists|test-execution` items; alignment reviewer picks up `cross-file-cohesion|llm-judgment`.
- Add `source` field citing the framework (12F-VII, OWASP-A02, etc.) — surfaced in UI as a tooltip.

**Expected Outputs**:
- `daemon/presets/saas-web.yaml` … `ml-script.yaml` regenerated.
- `daemon/src/preset/loader.ts` honors `appliesTo` filtering and `mechanism` routing.
- Agent 3's full source-cited table baked into `docs/details/preset-source-of-truth.md`.

**How To Verify**:
- Schema test: every preset item has `id`, `severity`, `mechanism`, `appliesTo`, `source`.
- Routing test: feed a candidate to static-gate, assert it only ran checks where `mechanism ∈ {static-grep,file-exists,test-execution}`.
- Dogfood: run d2p against `fixtures/demo-cli` and verify the new preset items match Agent 3's table.

**Probes**: haiku probe — given a preset YAML, output `{itemCount, perMechanism: {…}, perApplyTo: {…}}`. Compare to expected.

**Source**: Agent 3 full report, with all source URLs preserved in the table.

---

## F3 · Failure-mode badges · MUST

**One-line**: d2p watches its own agent for known autonomous-agent pathologies (fixation, thrash, critic-bias, runaway-cost) and surfaces them as Mission Control badges.

**Why**: every publicly-documented Devin/Replit failure (DB wipe, irrelevant fix loop, persistent on impossible task) shares one of a small number of signatures. Naming them earns user trust faster than "trust me, the reviewers caught it." This is a unique differentiator — no competitor surfaces "I think my agent is stuck in fixation" as a first-class UI state.

**Plan**:
- New `daemon/src/health/pathology.ts` watcher reading the event stream.
- Detect 4 signatures:
  - **fixation**: same gap, ≥3 attempts in a row hitting the same file with reviewer rejection.
  - **thrash**: >X% commits reverted within Y minutes.
  - **critic-bias**: reviewer disagreement rate >threshold over rolling window (suggests cross-engine pairing is off).
  - **runaway-cost**: spend rate > budget-derived threshold per gap.
- Emit `PATHOLOGY_DETECTED` SSE events.
- Track C UI: top status bar shows red/amber badges; click expands to the offending event chain.

**Expected Outputs**:
- `daemon/src/health/pathology.ts` + unit tests for each signature.
- 4 new SseEnvelope kinds + UI panel.
- Documented thresholds in `docs/details/pathology-detection.md` (and configurable via config).

**How To Verify**:
- Unit: feed a synthetic event stream that should trigger each signature; assert detector fires.
- Unit: feed a clean stream; assert no false positives.
- E2E: inject a fake-claude that intentionally fixates; UI shows the fixation badge.

**Probes**: haiku probe — given an event stream JSON, output `{fixation: bool, thrash: bool, criticBias: bool, runawayCost: bool}`. Compare to deterministic detector.

**Source**: Agent 2 — Devin failure-mode reports, Replit prod DB wipe incident, AI Agent Observability 4-pillars piece.

---

## F4 · Prompt caching + per-role cost attribution · SHOULD

**One-line**: cache the stable prefix (codebase snapshot + diff + reviewer pipeline spec) across the detector/differ/implementer/4-reviewer chain; tag every token spend with `{gap_id, attempt_id, engine, role}`; surface cache hit-rate and per-role cost in Track C gauges.

**Why**: d2p's loop calls the same model with the same big context 6–10 times per gap (detector once, then implementer + 4 reviewers per attempt, × K attempts). Prompt caching gives a documented 70–90% input-token cost reduction with zero architectural change. Cost attribution + cache visibility also closes the Mission Control's biggest data gap right now — the cost gauge currently just shows a running total with no breakdown.

**Plan**:
- For `anthropic-api` engine: add `cache_control: { type: "ephemeral" }` breakpoints around the stable codebase + diff blocks.
- For `openai-compat`: most providers don't expose this; auto-detect support (MiniMax / Moonshot support it; route others to no-cache).
- For `claude-cli`: detect cache_read / cache_write tokens from CLI output.
- Tag every spend in SQLite: extend cost-totals table with `gap_id, attempt_id, role, engine, cache_read, cache_write` columns.
- UI: new "Spend attribution" panel (per-role stacked bar); existing cost gauge gets a cache-hit % sub-line.

**Expected Outputs**:
- Updated engine impls with cache_control breakpoints.
- New `cost_attribution` SQLite table + migration.
- UI: per-role cost bar, cache hit gauge.

**How To Verify**:
- Unit: mock Anthropic response with `cache_read_input_tokens=1000`; assert it's stored as cache_read.
- E2E: dummy session running 3 gaps, verify rollup totals match per-event sum.
- Mission Control screenshot includes cache-hit gauge with non-zero value (in `?preview=c/workspace` mock).

**Probes**: haiku probe on a recorded daemon log — output `{totalSpend, perRole: {…}, cacheHitPct}`. Compare to deterministic aggregation.

**Source**: Agent 1 — Anthropic prompt-caching docs; Agent 2 — Aider/Cursor cost meter patterns.

---

## F5 · Skills as agent prompt unit · NICE

**One-line**: bundle each agent role (detector, differ, implementer, alignment, behavioral, adversarial) as a Skill (frontmatter + markdown body + optional bundled reference files); let projects drop `<demo>/.d2p/skills/*.md` to override or extend without writing TypeScript.

**Why**: Anthropic's three-tier loading pattern (metadata at session start → SKILL.md on trigger → bundled refs on demand) keeps prompts maintainable as they grow. Today d2p's prompts are TS string literals — readable, but not user-modifiable. Skill-formatting them turns the prompt set into a versioned, shareable artifact AND opens a clean extension path: a user with domain knowledge (e.g., "always run mypy in strict mode for python projects") drops a markdown file, no code changes required.

**Plan**:
- Define skill schema (mirrors Anthropic's: `name`, `description`, `metadata.role`, body).
- Migrate existing prompts (`daemon/src/prompts/templates.ts`) to `daemon/skills/*.md`.
- Loader resolves `<demo>/.d2p/skills/<role>.md` first, then daemon skills, then bundled defaults.
- UI: Settings page gains "Active skills" panel listing what's loaded + from where (daemon / project / default).

**Expected Outputs**:
- 8+ skill files under `daemon/skills/`.
- New `daemon/src/skills/loader.ts` + tests.
- Doc: `docs/details/skills-format.md` (mirroring Anthropic's authoring guide, attributed).

**How To Verify**:
- Unit: drop a project skill, assert it overrides the daemon default.
- Unit: malformed frontmatter rejected with a clear error.
- E2E: settings panel lists exactly the loaded skills.

**Probes**: haiku probe — given a skill markdown file, parse and output the metadata as JSON.

**Source**: Agent 1 — Claude Code Skills overview + authoring best practices URLs.

---

## F6 · Budget cap + auto-degrade · NICE

**One-line**: per-session soft + hard cost cap. Soft cap auto-drops the worker model tier (sonnet → haiku); hard cap kills in-flight attempts and emits a NEED_HUMAN escalation.

**Why**: Replit's "effort-based billing" exists because users will tolerate autonomy only if they trust the budget. Devin's opaque pricing is widely cited as a trust-killer. d2p targets users on tokenplans (MiniMax / DeepSeek / Z.ai etc.) — they will run d2p for hours; a budget cap turns "I'm afraid to leave this running" into "I'll let it burn $5 and check back."

**Plan**:
- Session config: `costBudget: { softUsd: 5.00, hardUsd: 10.00, onSoftBreach: 'downgrade'|'pause' }`.
- Daemon checks running total before each LLM call; if over soft → swap the requested model tier down; if over hard → fail-fast.
- UI: cost gauge shows soft cap (yellow line) + hard cap (red line); badge appears on breach.

**Expected Outputs**:
- Config schema updated.
- `daemon/src/budget/cap.ts` + tests.
- UI gauge + breach badge wired in Workspace.

**How To Verify**:
- Unit: spend > soft → next call's requested model is degraded.
- Unit: spend > hard → next call returns budget-exceeded error.
- E2E: configured budgets visible in UI; synthetic spend triggers expected UI states.

**Probes**: haiku probe — given a session config + cumulative spend, output the action (`proceed | downgrade | abort`).

**Source**: Agent 2 — Replit Agent 3 effort-based billing, Aider per-message meter, CostHawk token-budget piece.

---

## Order of work

The user explicitly chose: **iterate UI mockups first with mock data, then implement backend.**

Suggested per-feature sequence:
1. F2 (preset refresh) — touches all reviewer screens; do the preset YAML rewrite + mechanism tags first because every UI surface reads from it. Mostly backend; UI side is a tooltip + source-citation widget.
2. F1 (cross-engine critic) — add `criticEngine` field to the Workspace mock data, build the badge in `?preview=c/workspace`, then router behind it.
3. F3 (failure badges) — extend the existing status bar in Track C Workspace with the 4 badge slots; build detectors after mock approved.
4. F4 (caching + cost attribution) — extend the existing cost gauge + spend-attribution panel mock first; engine plumbing after.
5. F5 (skills) — Settings page extension first; migration after.
6. F6 (budget cap) — cost gauge gets cap lines first; budget logic after.

Each step: mock first in `?preview=c/<page>`, user signs off, then implement the daemon side.

---

## What was researched but explicitly NOT taken

- **Diff approval per tool call** (Cursor, Cline) — violates hands-off.
- **IDE plugin integration** (Cursor, Cline) — wrong form factor.
- **MCP extension marketplace** (Goose) — sprawls tool registry; d2p drives one tool by design.
- **Two-tier model routing inside one attempt** (Aider Architect) — interesting but adds complexity inside attempt; deferred.
- **Forced-pause checkpoints (max tool calls)** (Cursor, SWE-agent) — overlaps with budget cap; redundant.
- **Immutable event replay scrubber** (OpenHands V1) — nice but not differentiating; deferred.
- **Inline pre-commit static gate** (SWE-agent) — defers to F2 + existing post-commit gate; revisit if F2 doesn't catch enough.
- **Chat IM surface** (every general agent product) — would invite users to steer; d2p's pitch is no-steering.

---

## Source URLs (all 3 agents combined)

**Anthropic**:
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview.md
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices.md
- https://platform.claude.com/docs/en/build-with-claude/prompt-caching.md
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-combinations.md
- https://code.claude.com/docs/en/how-claude-code-works.md
- https://code.claude.com/docs/en/hooks.md

**Industry leaders**:
- https://cognition.ai/blog/devin-annual-performance-review-2025
- https://arxiv.org/abs/2407.16741 (OpenHands)
- https://arxiv.org/abs/2405.15793 (SWE-agent)
- https://aider.chat/docs/usage/modes.html
- https://docs.cline.bot/core-workflows/plan-and-act
- https://www.infoq.com/news/2025/11/cursor-composer-multiagent/
- https://www.infoq.com/news/2025/09/replit-agent-3/
- https://block.github.io/goose/docs/goose-architecture/extensions-design/

**Production-readiness**:
- https://12factor.net/
- https://owasp.org/Top10/2025/0x00_2025-Introduction/
- https://sre.google/sre-book/launch-checklist/
- https://webaim.org/projects/million/
- https://github.com/ossf/scorecard/blob/main/docs/checks.md
- https://vercel.com/docs/production-checklist
- https://fly.io/docs/launch/deploy/
- https://packaging.python.org/en/latest/guides/writing-pyproject-toml/
- https://docs.npmjs.com/cli/v7/configuring-npm/package-json/
