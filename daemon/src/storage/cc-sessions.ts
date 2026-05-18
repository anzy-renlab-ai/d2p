import type Database from 'better-sqlite3';

// Storage layer for the Mode A multi-turn driver (Batch 2 of the import plan).
// Three independent surfaces:
//
//   1. cc_sessions — (run_id, role) → cc_session_id for `claude --resume`
//      continuity. Upsert semantics: same key replaces the old session_id.
//   2. cc_turn_events — append-only feed of every hook event captured by the
//      stream launcher. Source ∈ {session-start, stop, result, error,
//      heartbeat}. Powers the live SSE stream + post-mortem replay.
//   3. cc_scratchpad — implementer-written progress notes that survive across
//      turns. Reviewer pipeline reads these once the implementer self-reports.

export type CcTurnEventSource = 'session-start' | 'stop' | 'result' | 'error' | 'heartbeat';

export interface CcSessionRow {
  runId: string;
  role: string;
  ccSessionId: string;
  lastTurnIdx: number;
  createdAt: number;
  updatedAt: number;
}

export interface CcTurnEventRow {
  id: number;
  runId: string;
  turnIdx: number;
  source: CcTurnEventSource;
  payloadJson: string;
  ts: number;
}

export interface CcScratchpadRow {
  id: number;
  runId: string;
  turnIdx: number;
  text: string;
  ts: number;
}

export function upsertCcSession(
  db: Database.Database,
  args: {
    runId: string;
    role: string;
    ccSessionId: string;
    turnIdx: number;
    now?: number;
  },
): void {
  const now = args.now ?? Date.now();
  db.prepare(
    `INSERT INTO cc_sessions(run_id, role, cc_session_id, last_turn_idx, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, role) DO UPDATE SET
       cc_session_id = excluded.cc_session_id,
       last_turn_idx = excluded.last_turn_idx,
       updated_at    = excluded.updated_at`,
  ).run(args.runId, args.role, args.ccSessionId, args.turnIdx, now, now);
}

export function getCcSession(
  db: Database.Database,
  runId: string,
  role: string,
): CcSessionRow | null {
  const r = db
    .prepare(
      `SELECT run_id, role, cc_session_id, last_turn_idx, created_at, updated_at
       FROM cc_sessions WHERE run_id = ? AND role = ?`,
    )
    .get(runId, role) as
    | {
        run_id: string;
        role: string;
        cc_session_id: string;
        last_turn_idx: number;
        created_at: number;
        updated_at: number;
      }
    | undefined;
  if (!r) return null;
  return {
    runId: r.run_id,
    role: r.role,
    ccSessionId: r.cc_session_id,
    lastTurnIdx: r.last_turn_idx,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function deleteCcSessionsForRun(db: Database.Database, runId: string): void {
  db.prepare('DELETE FROM cc_sessions WHERE run_id = ?').run(runId);
}

export function appendCcTurnEvent(
  db: Database.Database,
  args: {
    runId: string;
    turnIdx: number;
    source: CcTurnEventSource;
    payload: unknown;
    ts?: number;
  },
): number {
  const ts = args.ts ?? Date.now();
  const info = db
    .prepare(
      `INSERT INTO cc_turn_events(run_id, turn_idx, source, payload_json, ts)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(args.runId, args.turnIdx, args.source, JSON.stringify(args.payload), ts);
  return Number(info.lastInsertRowid);
}

export function listCcTurnEvents(
  db: Database.Database,
  runId: string,
  opts: { sinceId?: number; limit?: number } = {},
): CcTurnEventRow[] {
  const sinceId = opts.sinceId ?? 0;
  const limit = opts.limit ?? 1000;
  const rows = db
    .prepare(
      `SELECT id, run_id, turn_idx, source, payload_json, ts
       FROM cc_turn_events
       WHERE run_id = ? AND id > ?
       ORDER BY id ASC
       LIMIT ?`,
    )
    .all(runId, sinceId, limit) as {
    id: number;
    run_id: string;
    turn_idx: number;
    source: CcTurnEventSource;
    payload_json: string;
    ts: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    turnIdx: r.turn_idx,
    source: r.source,
    payloadJson: r.payload_json,
    ts: r.ts,
  }));
}

export function writeScratchpadNote(
  db: Database.Database,
  args: { runId: string; turnIdx: number; text: string; ts?: number },
): number {
  const ts = args.ts ?? Date.now();
  const info = db
    .prepare(
      `INSERT INTO cc_scratchpad(run_id, turn_idx, text, ts)
       VALUES (?, ?, ?, ?)`,
    )
    .run(args.runId, args.turnIdx, args.text, ts);
  return Number(info.lastInsertRowid);
}

export function readScratchpad(
  db: Database.Database,
  runId: string,
): CcScratchpadRow[] {
  const rows = db
    .prepare(
      `SELECT id, run_id, turn_idx, text, ts
       FROM cc_scratchpad
       WHERE run_id = ?
       ORDER BY ts ASC, id ASC`,
    )
    .all(runId) as {
    id: number;
    run_id: string;
    turn_idx: number;
    text: string;
    ts: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    turnIdx: r.turn_idx,
    text: r.text,
    ts: r.ts,
  }));
}

export function clearScratchpadForRun(db: Database.Database, runId: string): void {
  db.prepare('DELETE FROM cc_scratchpad WHERE run_id = ?').run(runId);
}
