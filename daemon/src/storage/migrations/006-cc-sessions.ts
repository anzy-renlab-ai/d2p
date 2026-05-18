import type { Migration } from './index.js';

// Batch 2 of the Mode A import (docs/plans/2026-05-18-mode-a-import.md):
// adds the schema the multi-turn driver needs.
//
//   - cc_sessions: persists (run_id, role) → cc_session_id so a follow-up
//     spawn can attach --resume <session_id> and inherit the live cc context.
//   - cc_turn_events: append-only timeline of every hook event (SessionStart /
//     Stop / NDJSON result) the launcher captures during a multi-turn run.
//     Powers the live UI feed without re-parsing transcript files.
//   - cc_scratchpad: implementer-written progress notes that survive across
//     turns. Lets reviewer (running once after self-report) and post-mortem
//     readers see what the agent was thinking turn-by-turn without re-hydrating
//     the full transcript. Inspired by Cairn's scratchpad — but scoped per run
//     and stripped of the multi-agent coordination semantics.
//   - gaps.complexity: 'simple' | 'complex'. The orchestrator's complexity
//     judge (Batch 4) tags new gaps; the router (Batch 5) uses this to decide
//     single-turn vs multi-turn engine path. Defaults to 'simple' so existing
//     rows behave identically.

export const m006CcSessions: Migration = {
  version: 6,
  name: 'cc-sessions',
  upSql: `
    CREATE TABLE cc_sessions (
      run_id TEXT NOT NULL,
      role TEXT NOT NULL,
      cc_session_id TEXT NOT NULL,
      last_turn_idx INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (run_id, role)
    );

    CREATE TABLE cc_turn_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      turn_idx INTEGER NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('session-start','stop','result','error','heartbeat')),
      payload_json TEXT NOT NULL,
      ts INTEGER NOT NULL
    );

    CREATE INDEX idx_cc_turn_events_run ON cc_turn_events(run_id, turn_idx);

    CREATE TABLE cc_scratchpad (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      turn_idx INTEGER NOT NULL,
      text TEXT NOT NULL,
      ts INTEGER NOT NULL
    );

    CREATE INDEX idx_cc_scratchpad_run ON cc_scratchpad(run_id, turn_idx);

    ALTER TABLE gaps ADD COLUMN complexity TEXT NOT NULL DEFAULT 'simple'
      CHECK (complexity IN ('simple','complex'));
  `,
};
