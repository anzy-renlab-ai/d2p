# ZeroU — production-readiness for vibe-coded apps

> Run `zerou audit` on any local web app → get a structured proof of which
> functions/branches were exercised, what's broken, and what ZeroU can fix.
> Run `zerou enhance` to land structured logging, a health endpoint, sentry,
> and mechanical bug fixes on a separate git branch you review before merge.

**Repo**: https://github.com/Upp-Ljl/d2p (internal name still `d2p`)

> **Scope**: ZeroU audits **application code you wrote** (Node/TypeScript
> webapps — Next.js / Express / Fastify / Koa / Nest handlers, lib/utility
> code, middleware, `.env` config). Not a SAST scanner for npm packages,
> not a runtime fuzzer, not a CVE database. See [What ZeroU is for](#what-zerou-is-for) below.

**Status**: alpha. 961 tests across `cli/` + `ui/`. Dogfooded on a real
Next.js + Drizzle + Supabase project. Bench results from hardener-bench
3-fixture run logged below. No public release yet.

## What ZeroU is for

ZeroU audits the **application code you write** — the Next.js routes,
Express handlers, lib/ utilities, auth middleware, env config of an
actual webapp. It's designed for the **vibe-coded demo → production**
moment: someone shipped a working prototype with Lovable / Bolt / v0 /
hand-rolled, and you want to know what's missing before paying customers
land.

**Sweet spot** (highest signal):

- Solo dev's prototype on Vercel that needs to harden before launch
- 1-3 person team's MVP that has working features but no auth review
- Hackathon project graduating to a real product

Supported app stacks (auto-detected): Next.js, Express, Fastify, Koa, Nest.

**Not what ZeroU does**:

- ❌ SAST for npm packages / library internals (use Snyk / Socket / `npm audit`)
- ❌ Runtime fuzzing of HTTP endpoints (use tspr, ZAP, Burp)
- ❌ Dependency vulnerability database lookup (use `npm audit` + Dependabot)
- ❌ Compliance audits (use Drata, Vanta for SOC2 etc.)
- ❌ Replacing your security engineer's judgment

If you point ZeroU at a `node_modules` directory or an npm package's source
tree, it will produce false positives — its detection patterns are
calibrated for application code, not library internals. By default it
skips library patterns (`--scope=app`); use `--scope=all` if you really
want to scan everything.

## Bench results

ZeroU was tested on hardener-bench (3 fixtures, 2026-05-28):

| Fixture | What it tests | ZeroU result |
|---|---|---|
| `zerou-target` | 19 app-layer static patterns (auth / SQL / CORS / secrets / ...) | P=0.91 R=1.00 |
| `secbench-subset` | 28 real npm package CVEs | not in scope* |
| `tspr-target` | 6 HTTP behavior bugs (need real requests) | not in scope* |

*ZeroU is a static analyzer for application code. The npm CVE bench
needs a SAST product (or `npm audit` + Dependabot); the HTTP behavior
bench needs a runtime fuzzer like `tspr`. When run against
`secbench-subset` ZeroU produced 406 findings of which 0 matched the
labelled CVEs — its app-layer patterns generate noise on library
internals, which is exactly why `--scope=app` is the default.

The `zerou-target` recall number is on its sweet-spot fixture (19
application-layer static patterns); don't generalize to "ZeroU catches
100% of bugs". Multi-project bench data is still pending (see
[What's NOT done](#whats-not-done)).

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

**Honest caveat**: the only public bench numbers today are the 3-fixture
hardener-bench result above. A v1 benchmark proposal was reviewed by a
hostile reviewer and sent back NEEDS-MAJOR-REVISION (see
`docs/reviews/2026-05-27-zerou-benchmark-critique-v1.md`); a fuller
multi-project bench + defect-correlation study is still pending. The log
schema + hash chain are the parts that shipped.

## Commands

| Command | What it does | Phase plan |
|---|---|---|
| `zerou audit <path>` | scan + LLM-judge + emit vitest + branch-coverage + branch-trace | Phase 4-8, 11.1, 11.3, 11.5, 13 |
| `zerou audit <path> --scope <app\|all>` | filter scanned files: `app` (default) skips `node_modules` / `vendor` / minified / generated; `all` scans everything | Phase 17 |
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

- **Multi-project benchmark**: the 3-fixture hardener-bench result above
  is real but small. A multi-project bench + defect-correlation study is
  still pending — don't read `R=1.00` on `zerou-target` as a general
  claim about ZeroU's recall on arbitrary webapps.
- **Out-of-scope fixture coverage**: `secbench-subset` and `tspr-target`
  return 0% match by design — they ask for capabilities ZeroU doesn't
  have (npm CVE lookup; HTTP runtime fuzzing). Listed in the bench table
  so users know which tool to reach for instead.
- **`zerou pr`**: design only — pushing the enhance branch to a remote and
  opening a GitHub PR is a planned follow-up. Today `zerou enhance` stops
  at a local worktree commit.
- **Runtime-level instrumentation** of user code: not done. ZeroU uses
  c8/istanbul ranges as the run signal; we don't hook `require` / ESM
  loaders. Per `docs/reviews/2026-05-27-auto-instrument-prior-art.md`, the
  industry pattern is build-time wrappers + runtime hooks; ZeroU's
  source-rewriting is scoped to bootstrap files + bug-patch sites.
- **Language coverage**: Node + TypeScript application code (Next.js /
  Express / Fastify / Koa / Nest detected); Supabase-SSR + NextAuth auth
  shapes. Other ecosystems (Python / Go / Rust / Ruby) are not
  implemented.
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
