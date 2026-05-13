# Changelog

## Unreleased — Multi-engine + GitHub PR workflow

### Added
- **LLM engine abstraction** (`daemon/src/engines/`): all agent calls now go
  through an `LLMEngine` interface. Three backends ship:
    - `claude-cli` — spawn `claude` binary (back-compat default)
    - `openai-compat` — OpenAI Chat Completions wire format; covers
      OpenRouter / DeepSeek / Z.ai (智谱 GLM) / Moonshot (Kimi) / Qwen /
      OpenAI / vLLM / LM Studio / any compatible server
    - `anthropic-api` — direct Anthropic Messages API via raw `fetch`
- **Persistent config** at `~/.d2p/config.json` with zod validation,
  hot-reloadable via `POST /api/config`. API keys + GitHub token redacted
  in `GET /api/config` responses.
- **GitHub PR session mode**: new `sessions.mode` column. In `github-pr`
  mode, the orchestrator pushes `fix/<slug>` to `origin` via PAT URL and
  opens a PR through the GitHub REST API. No SDK dependency — minimal
  `GitHubClient` in `daemon/src/github/client.ts`. d2p does NOT auto-merge
  (per CLAUDE.md "merge needs user").
- **Settings page** in the UI: engine kind selector, model-name maps,
  baseUrl, API key, GitHub token; 6 OpenAI-compat platform presets
  (OpenRouter / DeepSeek / Z.ai / Moonshot / OpenAI / Qwen). Accessible
  via "⚙ 设置" button in the header.
- **GitHubSessionSetup** component: in the Setup page, switch the current
  session to PR mode and configure repo + base branch.
- Migration `004-mode-github`: adds `sessions.mode`, `sessions.github_repo`,
  `sessions.base_branch`, `fixes.pr_number`, `fixes.pr_url`.
- 20 new tests across `engines/openai-compat`, `engines/anthropic-api`,
  `github/client`, `config/load`. Total: 91 tests / 15 files.

### Changed
- `subproc/claude.ts` is now a thin facade delegating to the active engine
  in `engines/registry`. Existing agents are unchanged.
- DEV-DOC's "round-10 = 不用 key" lock is explicitly overridden by user on
  2026-05-13; engine choice now belongs to per-install config.

### Verified
- typecheck green (daemon / ui / cli)
- 91 unit tests pass (4.4s)
- UI build green (189 KB / 60 KB gzipped)
- walking-skeleton smoke green (claude-cli mode, fake-claude shim, full
  detector → vision → loop → merge → done → session-end → summary)

## 0.2.0 — Original product goal complete

### Added (after the "MVP-0" boundary the previous entry stopped at)
- **Cross-engine reviewer** (`runCrossEngineCheck`): on high-sensitivity gaps
  the orchestrator spawns a second independent behavioral reviewer; verdict
  disagreement forces ROLLBACK with merged hints + a
  `CROSS_ENGINE_DISAGREEMENT` escalation. Implements the second pass that
  round-10 / round-11 flagged as the most important review layer.
- **Continuous chase** (ABCD #D): removed the hard `MAX_DIFFER_PASSES` cap;
  loop only pauses when (a) preset+vision double-green (DONE), (b) user
  pauses, or (c) the differ produces nothing new for `STUCK_THRESHOLD`
  consecutive rounds AND not double-green.
- **Live re-diff watcher**: `node:fs.watch` on `<demo>/.d2p/{vision,preset-overrides,check-commands}.{md,yaml}`.
  An edit resets the stuck counter, reloads `vision.md`, and emits
  `LOOP_RESUMED { reason: 'watcher_dirty' }`.
- **Non-code inputs** (`/api/inputs` GET/POST + `<demo>/.d2p/inputs/`): user
  attaches PRD / API spec / mockup notes; the vision elicitor folds them
  into the drafts payload.
- **Deploy target detection** (ABCD #C, `/api/deploy/targets`): scans for
  vercel.json / fly.toml / netlify.toml / Dockerfile / Procfile /
  wrangler.toml / prepublishOnly / build scripts; returns ranked candidate
  list with recommended command + docs link.
- **System service installer** (round-9 lock): `d2p install-service` emits
  per-platform artifacts under `~/.d2p/service/`:
    - Windows: `install.cmd` + `uninstall.cmd` using `sc create d2p-daemon`
    - macOS: `local.d2p-daemon.plist` for launchd
    - Linux: `d2p-daemon.service` for `systemctl --user`
  No privileged operations are run by d2p itself; the CLI prints the
  exact next steps the user runs once.
- **Architectural pause hand-off UX**: Workspace page surfaces a banner
  when the loop is PAUSED due to a reviewer ARCHITECTURAL escalation,
  with the reviewer's rationale + a hint to edit `vision.md` or
  `preset-overrides.yaml` to unstick (watcher then auto-resumes).
- **Preset override editor** (UI, ABCD #B): in-page yaml editor in Setup
  AND Workspace (visible while paused) that saves to
  `<demo>/.d2p/preset-overrides.yaml`.
- **Inputs editor** (UI): textarea + filename for attaching non-code
  background material.
- **Deploy targets card** (UI): rendered on the Done page.
- 14 new daemon tests (`deploy/detect`, `inputs/store`, `service/install`).
  Total: 71 tests across 11 files.

### Workflow rule updates
- `CLAUDE.md` §Gates: a new bullet defines "完成" as **the original product
  goal**, not a phase boundary. Phase splits are for ordering, not
  stopping. The SELF-REPORT-STOP self-check gains field
  `phased_premature_stop` (#13) — treating MVP-N / Phase-N / Walking
  Skeleton boundaries as a stop reason is now an explicit violation,
  equivalent to `followup_punt`.
- Memory: `feedback_no_phased_premature_stop.md` captures the rule for
  future sessions.

### Verified
- `npm run typecheck` clean on daemon / ui / cli.
- 71 daemon unit tests pass (4.71s) across 11 files.
- `npm run build` green (UI 181 KB raw / 57 KB gzipped).
- Smoke `node scripts/smoke-walking-skeleton.mjs` end-to-end: detector →
  vision finalize → loop → merge → done-check → SESSION_DONE → deploy
  targets queryable → input save+list → preset override save → session/end
  → `session-summary.md` (826 bytes) → ENDED.

## 0.1.0-mvp0 — MVP-0 complete

### Added
- **UI 4 pages wired end-to-end**: Landing (pick demo folder) → Setup (detector
  confirm + multi-round vision elicit + preset choose) → Workspace (3-column:
  GapList / RunLog with milestone filter / SidePanel with preset progress,
  cost, vision) → Done (summary stats + closed/skipped/need-human breakdown).
- Components: `Button`, `ErrorBanner`, `HealthBadge` (surfaces SSE stream state),
  `GapList` (grouped by status, severity-coded, expandable detail, inline
  skip), `RunLog` (filterable, auto-scroll, click to expand raw payload),
  `SidePanel` (preset progress bar + cost + vision render).
- Live SSE log stream client with exponential-backoff reconnect.
- Zustand store covers full session lifecycle + event-driven refresh.
- Session summary: `POST /api/session/end` now generates
  `<demo>/.d2p/session-summary.md` with stats, closed gaps, NEED_HUMAN reasons,
  cost, and the full vision.
- Daemon crash recovery on startup: stale `*_RUNNING` fixes are auto-DROPPED
  and stale LOOPING sessions move to PAUSED.
- Enriched `GET /api/doctor` checks: `claude-cli-reachable` / `git` /
  `db-dir-writable` / `tempdir-writable` / `presets-loaded`.
- CLI `d2p status` now includes session + loop state when daemon is up.
- New daemon unit tests: real-git worktree ops, preset loader, static-gate
  command runner.

### Verified
- `npm run typecheck` green on daemon / ui / cli.
- 57 daemon unit tests pass across 8 files.
- `npm run build` green (UI 56 modules, 174 KB raw / 55 KB gzipped).
- Smoke `node scripts/smoke-walking-skeleton.mjs` runs end-to-end:
  detector → vision finalize → loop → merge → done-check → `/api/session/end` →
  asserts `session-summary.md` on disk (826 bytes) and session status `ENDED`.

## 0.1.0-skeleton — MVP-0 walking skeleton

### Added
- Daemon (`@d2p/daemon`): Hono server, SQLite + 3 migrations, 9 agent prompts +
  zod schemas, `claude` / `git` subprocess wrappers with timeout + injection
  guard, full reviewer pipeline (alignment / behavioral / adversarial), git
  worktree manager, orchestrator loop, REST + SSE routes for session / vision
  / detector / preset / loop / gaps / log / health.
- UI (`@d2p/ui`): minimal Vite + React + Tailwind scaffold; health badge + SSE
  live event log.
- CLI (`@d2p/cli`): `d2p start | stop | status | open | doctor`.
- 6 internal presets covering saas-web / api-service / cli-tool / library /
  static-site / unknown.
- End-to-end smoke (`scripts/smoke-walking-skeleton.mjs`) driven by a
  `scripts/fake-claude.mjs` shim. Asserts at least one merged fix and a
  `SESSION_DONE` transition.
- 36 daemon unit tests across state machine, migrations, queries, prompt
  render, and path utilities.

### Verified
- `npm install`, `npm run typecheck`, `npm test`, `npm run build`, and
  `node scripts/smoke-walking-skeleton.mjs` all green on Windows 11 + Node 24.
