# ZeroU — production-readiness for vibe-coded apps

> Run `zerou audit` on any local web app → get a structured proof of which
> functions/branches were exercised, what's broken, and what ZeroU can fix.
> Run `zerou enhance` to land structured logging, a health endpoint, sentry,
> and mechanical bug fixes on a separate git branch you review before merge.

**Repo**: https://github.com/Upp-Ljl/d2p (internal name still `d2p`)
**Status**: alpha. 961 tests across `cli/` + `ui/`. Dogfooded on a real
Next.js + Drizzle + Supabase project. No public release yet.

## What ZeroU does (扫 + 修 + 验 + 追溯)

1. **扫 (scan)** — TypeScript AST walks every function and branch; static
   preset checks across 11 hardening categories (auth, authz, secrets,
   security-headers, db hygiene, observability, error handling, tests, perf,
   GDPR, deploy-incident, llm-cost).
2. **测 (test)** — LLM generates Vitest spec files per endpoint / function;
   an adversarial LLM-judge evaluates each spec against the actual source
   with information isolation (no leaking spec name / category / reasoning).
   Auth-aware: Supabase-SSR + NextAuth mocks emitted automatically.
3. **修 (fix)** — `zerou enhance` injects a production-grade pino logger,
   a `/health` endpoint, the Sentry SDK, missing `.env.example` vars, and
   mechanical bug patches (escapeXml, encodeURIComponent, missing-await,
   silent-catch). All on a worktree, behind regex-hardening that respects
   shebangs / directives / BOMs / JSX / template literals.
4. **验 (verify)** — re-runs `npm install` + `tsc --noEmit` + your existing
   test suite + `npm run build`. Refuses to ship a worktree if any step
   breaks. Verify chip-grid in the report shows per-step status.
5. **追溯 (trace)** — every AST branch gets a stable `branch_id`; runs emit
   a hash-chained `.zerou/branch-trace.jsonl` in OpenTelemetry wide-event
   form. `cat | jq '.branch_id' | sort -u | wc -l` proves the AST coverage
   number without any UI.

## Quick start

```bash
# 1. audit — scan + LLM-judge + emit vitest + branch-coverage
zerou audit ./my-next-app

# 2. enhance — suggest fixes on a worktree branch (NEVER auto-merges)
zerou enhance ./my-next-app

# 3. review — React Mission Control UI, local-only, SSE live updates
zerou review ./my-next-app --serve
# → http://127.0.0.1:7777

# 4. coverage — CI gate, exits non-zero if coverage < threshold
zerou coverage ./my-next-app --threshold 80

# 5. trace — grep events by trace id or path
zerou trace --last --path ./my-next-app
```

The default LLM engine is OpenAI-compat (MiniMax / DeepSeek / OpenRouter
etc.); pass `--config <path>` to point at a config that sets your key. No
credentials are stored server-side; ZeroU runs entirely on your machine.

## The differentiator: log stream IS the proof

Most coverage tools report a percentage and ask you to trust them. ZeroU
emits `.zerou/branch-trace.jsonl` — one JSONL line per AST branch, with
OpenTelemetry semantic fields (`trace_id`, `code.function`,
`code.file.path`, `code.line.number`), the four signals (AST × spec ×
LLM-judge × runtime; a fifth log-emit signal is planned), the verdict,
and a SHA-256 hash chain (`seq` / `prev_hash` / `hash`) that makes the
file tamper-evident.

A third party can verify ZeroU's published coverage by running the same
workflow on the same fixture, byte-compare the `branch_id` set, and
recompute the hash chain with `zerou coverage --verify-chain`.

**Honest caveat**: a v1 benchmark proposal was reviewed by a hostile
reviewer and rejected (see `docs/reviews/2026-05-27-zerou-benchmark-critique-v1.md`).
Real benchmark numbers are deferred until multi-project data and a
defect-correlation study exist. The log schema is the part that shipped.

## Commands

| Command | What it does | Phase plan |
|---|---|---|
| `zerou audit <path>` | scan + LLM-judge + emit vitest + branch-coverage + branch-trace | Phase 4-8, 11.1, 11.3, 11.5, 13 |
| `zerou enhance <path>` | inject logger + health + sentry + .env + bug fixes on a worktree | Phase 10, 10.5, 10.6, 11.3 |
| `zerou review <path>` | open static HTML report in browser | Phase 11.2, 11.4 |
| `zerou review <path> --serve` | local HTTP + React Mission Control UI + SSE | Phase 12, 14, 14.5, 14C |
| `zerou coverage <path>` | proof-of-coverage gate, reads `branch-trace.jsonl` | Phase 13.2 |
| `zerou trace [id]` | filter structured log events by trace id / path | earlier |

Subcommand details and option lists live in `cli/src/zerou-cli.ts` and the
per-command source files.

## Safety model

- All `zerou enhance` changes go to `.worktrees/zerou-enhance-<ts>/` on a
  separate branch.
- ZeroU **never** auto-merges and **never** pushes to your remote. You
  review the diff (`git diff main..HEAD` from inside the worktree, or
  through the React UI) and merge yourself.
- `zerou review --serve` binds 127.0.0.1 only; no auth, no TLS, but also
  no exposure beyond `localhost`.
- The verify harness refuses to declare a run successful if your existing
  test suite breaks after the worktree changes.

## What's NOT done

- **Benchmark v1**: deferred (hostile-reviewer NEEDS-MAJOR-REVISION; awaits
  multi-project data + defect-correlation study + 9 patches from the
  critique).
- **`zerou pr`**: design only — pushing the enhance branch to a remote and
  opening a GitHub PR is a planned follow-up. Today `zerou enhance` stops
  at a local worktree commit.
- **Runtime-level instrumentation** of user code: not done. ZeroU uses
  c8/istanbul ranges as the run signal; we don't hook `require` / ESM
  loaders. Per `docs/reviews/2026-05-27-auto-instrument-prior-art.md`, the
  industry pattern is build-time wrappers + runtime hooks; ZeroU's
  source-rewriting is scoped to bootstrap files + bug-patch sites.
- **Language coverage**: Node + TypeScript (Next.js / Express); Supabase-SSR
  + NextAuth auth shapes. Other ecosystems (Python / Go / Rust / Ruby) are
  not implemented.
- **Streaming responses**: LLM calls are still wait-for-complete; concurrent
  via `p-limit` pool, not streamed.

## Architecture (high-level)

ZeroU is a 2-workspace monorepo:

- `cli/` — Node + TypeScript. The `audit` / `enhance` / `coverage` /
  `review` / `trace` commands.
- `ui/` — Vite + React + Tailwind. Served via `zerou review --serve` over
  a `node:http` server bound to 127.0.0.1.
- LLM layer is provider-agnostic (`anthropic-api` / `openai-compat`); used
  for spec generation + adversarial judge + bug-patch proposals. No
  credentials are bundled; the user's `--config` file or env vars carry
  them. Claude Code CLI (`claude-cli`) is still supported as an engine, but
  the dogfood loop uses MiniMax openai-compat by default.
- Optional `daemon/` directory contains the v0.7 demo-→-product loop
  (referred to as **advanced mode** in `CONTEXT.md`); kept runnable, not
  the public-facing default.

See `CONTEXT.md` for the domain glossary and `docs/plans/` for the
phase-by-phase plan history.

## Build + test

```bash
npm install
npm run build
npm test --workspace cli              # 734 pass / 1 fail (pre-existing) / 1 skip
npm test --workspace ui               # 227 pass
```

The one pre-existing CLI fail (`src/agent/runtime/index.test.ts > runRuntimeTests >
returns inconclusive results when launch fails`) is a port-binding flake on
local Windows and tracked but not yet quarantined.

## Repo layout

| Path | Contents |
|---|---|
| `cli/src/` | `audit.ts` / `enhance.ts` / `review.ts` / `coverage.ts` / `trace.ts` + `agent/` + `enhance/` |
| `cli/src/agent/` | project-detector, checklist-builder, ast-analyzer, test-emitter, vitest-orchestrator, branch-coverage, branch-trace + stream |
| `cli/src/enhance/` | log-planner / log-executor / bug-patcher / health-gen / sentry-installer / env-completer / verify / report / html-report / html-diff |
| `ui/src/pages/` | `ZerouReview.tsx` (5-stage pipeline) |
| `ui/src/components/` | `ZerouStage*` + `ZerouBranchTreeLog` + `ZerouHeatStrip` + `ZerouLogEventDrawer` |
| `presets/` | 13 markdown preset checks (auth / authz / security / db / obs / errors / tests / perf / llm-cost / gdpr / deploy / secrets-leak / supabase-rls) |
| `docs/plans/` | Dated phase plans (Phase 2 / 4 / 5 / 6-7 / 8 / 9-lite / 10 / 11.1-11.5 / 12 / 13 / 14) |
| `docs/details/` | SPEC-SPLIT artifacts (spec / public-surface / tests / comparison) |
| `docs/reviews/` | Prior-art investigations + hostile critiques |
| `docs/adr/` | Architecture decision records |
| `daemon/` | v0.7 demo-→-product loop (advanced mode, retained) |
| `fixtures/` | small demos for smokes |

## Status + license

Alpha. Don't run on production code without a clean git tree. ZeroU never
auto-merges, but a half-applied worktree can still leave noise in your
working dir if you Ctrl-C mid-run. License: TBD (decide before any public
push to npm).
