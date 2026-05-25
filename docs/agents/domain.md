# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This is a **single-context** repo: one `CONTEXT.md` at the root, ADRs under `docs/adr/`.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root (the project's domain glossary — terms like `底座`, `preset`, `finding`, `verdict`, `track`)
- **`docs/adr/`** — read ADRs that touch the area you're about to work in
- **`docs/details/`** — per-module specs (see `12-log-module-spec.md`, `13-protocol-2-spec.md`, etc.) and their SPEC-SPLIT artifacts (`*-public-surface.md`, `*-tests.md`, `*-comparison-report.md`)
- **`docs/PRODUCT-HYPOTHESIS.md`** — product theory (v0.7+) but check `docs/conflicts-with-v0.7.md` if it exists; the hardener pivot supersedes parts of v0.7

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CLAUDE.md                              ← agent work rules + 8 站台 + 3 安全网
├── CONTEXT.md                             ← domain glossary
├── docs/
│   ├── PRODUCT-HYPOTHESIS.md
│   ├── adr/                               ← architectural decisions
│   ├── agents/                            ← this folder (issue-tracker / triage-labels / domain)
│   ├── details/                           ← per-module SPEC-SPLIT artifacts
│   ├── plans/                             ← YYYY-MM-DD-<slug>.md execution plans
│   └── protocols/                         ← 3 底座 (Protocol-1/2/3) public specs
├── daemon/src/
├── cli/src/
└── ui/src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

In particular: prefer the bilingual terms used in `CONTEXT.md` (e.g. `底座` for "foundational protocol", `preset` for declarative check rules, `finding` for a single audit hit, `verdict` for a cross-engine review judgment). Don't translate them away or invent English-only synonyms.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (single-engine reviewer fallback) — but worth reopening because…_

If your output contradicts the v0.7 PRODUCT-HYPOTHESIS but aligns with the post-2026-05-24 pivot to hardener CLI + 3 底座, log it in `docs/conflicts-with-v0.7.md` instead of silently rewriting PHYP.
