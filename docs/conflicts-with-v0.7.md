# Conflicts with PRODUCT-HYPOTHESIS v0.7

Pivot-era log: every place where the 2026-05-24 pivot (hardener CLI + 3 底座) supersedes wording in `docs/PRODUCT-HYPOTHESIS.md` v0.7. Recorded here so the PHYP file is not silently rewritten mid-pivot; reframe in one pass at Phase 4 end.

Rule for adding entries:
- Log every contradiction you notice while writing pivot artifacts (specs, code, marketing copy).
- Cite the PHYP section verbatim, then the new pivot stance, then the location where the new stance is authoritative.
- Do not edit PHYP itself until the Phase 4 unified reframe.

---

## C-001 — Verdict namespace split

**PHYP v0.7 §3.1 / `daemon/src/types.ts:103`**:
> `Verdict = 'APPROVE' | 'RETRY_WITH_HINTS' | 'ROLLBACK' | 'ESCALATE'`
>
> "4-layer reviewer pipeline outputs a verdict on a candidate diff."

**Hardener pivot (Phase 1 Q1 + Q11)**:
> Hardener Verdict is a judgment on a single **finding**, not a diff. Values:
> `'confirmed' | 'false-positive' | 'needs-context' | 'critic-unavailable'`
>
> `needs-context` MUST carry `requiredContext: string[]` — empty array is equivalent to `false-positive`.
>
> The two `Verdict` types live in different namespaces and MUST NOT be unified. Demo→product `Verdict` stays in `daemon/src/types.ts` for the advanced-mode loop. Hardener `Verdict` lives in `core/protocol/cross-engine-reviewer/types.ts` (Phase 3).

**Authoritative location**: `docs/details/14-protocol-1-spec.md` (Phase 1).

---

## C-002 — Engine module path (`daemon/src/engines/*` → `core/engines/*`)

**PHYP v0.7 §3.1 / current code layout**:
> All engine implementations live under `daemon/src/engines/`, consumed only by the daemon process.

**Hardener pivot (Phase 1 Q6 micro)**:
> Hardener is an independent CLI process with zero daemon dependency. The cross-engine reviewer SDK (extracted in Phase 3) lands at `core/protocol/cross-engine-reviewer/`, and the engine abstraction itself is expected to migrate to `core/engines/` so both `daemon/` and `cli/` (and any third-party consumer) can import without crossing a daemon-private boundary.
>
> Phase 1 specs reference `core/...` import paths even though the actual move is Phase 3 work.

**Authoritative location**: `docs/details/14-protocol-1-spec.md` + `docs/details/15-hardener-cli-spec.md`.

---

## C-003 — Default execution form: daemon-driven loop → standalone CLI invocation

**PHYP v0.7 §5.1 / §10**:
> "MVP-0 default UX: user runs `d2p start`, daemon stays up, web UI orchestrates the loop until vision verdict YES + preset all green."

**Hardener pivot (Phase 1 Q6)**:
> `zerou audit <path>` is a single-shot CLI invocation. No daemon required. No web UI. No session persistence in SQLite. Output is stdout + optional `--out report.json` (EvidenceBundle skeleton).
>
> The daemon-driven demo→product loop is retained as "advanced mode" but is not the default surface.

**Authoritative location**: `docs/details/15-hardener-cli-spec.md`.

---

## C-004 — BYO-key configuration is default surface, not fallback

**PHYP v0.7 §3 red line 4 (softened in commit `8e02e24`)**:
> "Default CLI subprocess (`claude --model X -p`); HTTP+key is opt-in fallback."

**Hardener pivot (524归档 §1 + Phase 1 Q8)**:
> Vibe coder default = HTTP+key. Most vibe-coded-app authors pay for ChatGPT Plus / Claude.ai Pro web subscriptions and do NOT have `claude` / `codex` / `gemini` CLIs installed.
>
> Configuration is a three-layer lookup: `--key <provider>=...` flag > `ZEROU_<PROVIDER>_KEY` env > `~/.zerou/config.json` (chmod 600). CLI subprocess is supported but not default.

**Authoritative location**: `docs/details/14-protocol-1-spec.md` (engine selection) + `docs/details/15-hardener-cli-spec.md` (flag/env/config surface).

---

## C-005 — Configuration root path: `~/.d2p/` → `~/.zerou/`

**Current code (`daemon/src/config/load.ts`)**:
> Reads from `~/.d2p/config.json`. Env override `D2P_CONFIG_PATH`. Project-local override `<demo>/.d2p/`.

**Hardener pivot (524归档 §1)**:
> Product renamed `d2p` → `ZeroU`. Config root is `~/.zerou/`. Project-local overrides live at `<repo>/.zerou/` (presets + overrides + preset-overrides.yaml).
>
> Backward compatibility: `~/.d2p/` MAY be read as a fallback during Phase 3 transition, but Phase 1 docs reference `~/.zerou/` exclusively.

**Authoritative location**: `docs/details/13-protocol-2-spec.md` (preset lookup) + `docs/details/15-hardener-cli-spec.md` (config lookup).

---

## C-006 — Cross-engine policy hard-enforcement is conditional in hardener

**PHYP v0.7 §3.1 + commit `cef59d3` (PR #3)**:
> "Session creation enforces critic family ≠ worker family. `D2P_ALLOW_DEGRADED_REVIEWER=1` is a test-only escape hatch."

**Hardener pivot (Phase 1 Q11)**:
> Single-engine BYO-key users are the default vibe-coder persona. Hardener must run with one engine configured. When the critic engine is unavailable (same family as worker, or not configured at all), findings receive `verdict: 'critic-unavailable'` with a CLI summary nudging the user to configure a second engine.
>
> The session-creation hard-enforcement applies to advanced-mode daemon sessions only. Hardener CLI does not error on single-engine setups.

**Authoritative location**: `docs/details/14-protocol-1-spec.md` (failure modes).

---

## C-007 — Demo→product `Gap` / `PresetStatusItem` types remain advanced-mode only

**PHYP v0.7 §3 + `daemon/src/types.ts:222` + `daemon/src/types.ts:301`**:
> `Gap` and `PresetStatusItem` are the shared currency between differ, implementer, reviewer, done-check.

**Hardener pivot (Phase 1 Q1 + Q10)**:
> Hardener does not have a `Gap` concept (gap = vision-vs-current delta). It has `Finding` (preset check observation). The two types are not interchangeable and live in different module trees.
>
> `Finding` shape is defined in `core/protocol/preset/types.ts` (Phase 3 target) and owns:
> ```
> { id: string,  // <presetId>.<shortHash(file+line+ruleId+normalizedContent)>
>   presetId: string,
>   ruleId: string,
>   severity: 'P1' | 'P2' | 'P3',
>   file: string,
>   line: number,
>   evidence: string,
>   matched_content_normalized: string,
>   ... }
> ```

**Authoritative location**: `docs/details/13-protocol-2-spec.md`.

---

## How to add the next entry

When you find a new contradiction:

1. Pick the next `C-NNN` number.
2. Quote the PHYP / current-code stance with file:line.
3. State the pivot stance and where it is authoritative.
4. Do NOT edit PHYP. Add the conflict here only.

Phase 4 reframe pass will read this file end-to-end and rewrite PHYP sections in one shot.
