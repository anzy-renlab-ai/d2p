# Changelog

## Unreleased — MVP-0 complete

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
