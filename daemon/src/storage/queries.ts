import type Database from 'better-sqlite3';
import type {
  Demo,
  Session,
  Gap,
  Fix,
  LogEvent,
  SessionStatus,
  GapStatus,
  PresetStatusItem,
  CostTotals,
  ProjectType,
} from '../types.js';
import { asAbsPath } from '../util/path.js';
import { assertGapTransition, assertSessionTransition } from '../state/transitions.js';

interface DemoRow {
  id: number;
  path: string;
  first_seen_at: number;
  last_session_at: number | null;
  inferred_type: string | null;
}

interface SessionRow {
  id: number;
  demo_id: number;
  started_at: number;
  ended_at: number | null;
  status: SessionStatus;
  vision_md_path: string | null;
  preset_type: string | null;
}

interface GapRow {
  id: number;
  session_id: number;
  slug: string;
  title: string;
  body: string;
  category: string;
  severity: string;
  source: string;
  suggested_approach: string;
  expected_files_changed: string;
  status: GapStatus;
  dynamic_k: number | null;
  parent_gap_id: number | null;
  created_at: number;
  finished_at: number | null;
}

function demoFromRow(r: DemoRow): Demo {
  return {
    id: r.id,
    path: asAbsPath(r.path),
    firstSeenAt: r.first_seen_at,
    lastSessionAt: r.last_session_at,
    inferredType: r.inferred_type as ProjectType | null,
  };
}

function sessionFromRow(r: SessionRow): Session {
  return {
    id: r.id,
    demoId: r.demo_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    status: r.status,
    visionMdPath: r.vision_md_path ? asAbsPath(r.vision_md_path) : null,
    presetType: r.preset_type as ProjectType | null,
  };
}

function gapFromRow(r: GapRow): Gap {
  return {
    id: r.id,
    sessionId: r.session_id,
    slug: r.slug,
    title: r.title,
    body: r.body,
    category: r.category as Gap['category'],
    severity: r.severity as Gap['severity'],
    source: r.source as Gap['source'],
    suggestedApproach: r.suggested_approach,
    expectedFilesChanged: JSON.parse(r.expected_files_changed) as string[],
    status: r.status,
    dynamicK: r.dynamic_k,
    parentGapId: r.parent_gap_id,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  };
}

export class Queries {
  constructor(private db: Database.Database) {}

  // ─── demos ─────────────────────────────────────────────────────────────

  upsertDemo(demoPath: string): Demo {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO demos(path, first_seen_at) VALUES (?, ?)
         ON CONFLICT(path) DO NOTHING`,
      )
      .run(demoPath, now);
    const row = this.db.prepare('SELECT * FROM demos WHERE path = ?').get(demoPath) as DemoRow;
    return demoFromRow(row);
  }

  setDemoLastSession(demoId: number, ts: number): void {
    this.db.prepare('UPDATE demos SET last_session_at = ? WHERE id = ?').run(ts, demoId);
  }

  setDemoInferredType(demoId: number, type: ProjectType): void {
    this.db.prepare('UPDATE demos SET inferred_type = ? WHERE id = ?').run(type, demoId);
  }

  // ─── sessions ──────────────────────────────────────────────────────────

  findActiveSessionForDemo(demoId: number): Session | null {
    const row = this.db
      .prepare(
        `SELECT * FROM sessions WHERE demo_id = ?
         AND status IN ('SETUP','LOOPING','PAUSED')
         ORDER BY started_at DESC LIMIT 1`,
      )
      .get(demoId) as SessionRow | undefined;
    return row ? sessionFromRow(row) : null;
  }

  insertSession(demoId: number): Session {
    const now = Date.now();
    const result = this.db
      .prepare(`INSERT INTO sessions(demo_id, started_at, status) VALUES (?, ?, 'SETUP')`)
      .run(demoId, now);
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(result.lastInsertRowid) as SessionRow;
    return sessionFromRow(row);
  }

  getSession(id: number): Session | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
    return row ? sessionFromRow(row) : null;
  }

  getCurrentActiveSession(): Session | null {
    const row = this.db
      .prepare(
        `SELECT * FROM sessions WHERE status IN ('SETUP','LOOPING','PAUSED')
         ORDER BY started_at DESC LIMIT 1`,
      )
      .get() as SessionRow | undefined;
    return row ? sessionFromRow(row) : null;
  }

  transitionSession(sessionId: number, to: SessionStatus): void {
    const current = this.getSession(sessionId);
    if (!current) throw new Error(`session ${sessionId} not found`);
    assertSessionTransition(current.status, to);
    if (to === 'ENDED' || to === 'DONE') {
      this.db
        .prepare('UPDATE sessions SET status = ?, ended_at = ? WHERE id = ?')
        .run(to, Date.now(), sessionId);
    } else {
      this.db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(to, sessionId);
    }
  }

  setSessionVision(sessionId: number, visionMdPath: string): void {
    this.db
      .prepare('UPDATE sessions SET vision_md_path = ? WHERE id = ?')
      .run(visionMdPath, sessionId);
  }

  setSessionPresetType(sessionId: number, presetType: ProjectType): void {
    this.db.prepare('UPDATE sessions SET preset_type = ? WHERE id = ?').run(presetType, sessionId);
  }

  // ─── gaps ──────────────────────────────────────────────────────────────

  insertGap(input: Omit<Gap, 'id' | 'createdAt' | 'finishedAt' | 'status' | 'dynamicK'>): Gap {
    const now = Date.now();
    const result = this.db
      .prepare(
        `INSERT INTO gaps(session_id, slug, title, body, category, severity, source,
                          suggested_approach, expected_files_changed, status,
                          parent_gap_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
      )
      .run(
        input.sessionId,
        input.slug,
        input.title,
        input.body,
        input.category,
        input.severity,
        input.source,
        input.suggestedApproach,
        JSON.stringify(input.expectedFilesChanged),
        input.parentGapId,
        now,
      );
    const row = this.db.prepare('SELECT * FROM gaps WHERE id = ?').get(result.lastInsertRowid) as GapRow;
    return gapFromRow(row);
  }

  /** Pick highest-priority PENDING gap (P1>P2>P3, then created_at asc). */
  pickHeadGap(sessionId: number): Gap | null {
    const row = this.db
      .prepare(
        `SELECT * FROM gaps
         WHERE session_id = ? AND status = 'PENDING'
         ORDER BY
           CASE severity WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
           created_at ASC
         LIMIT 1`,
      )
      .get(sessionId) as GapRow | undefined;
    return row ? gapFromRow(row) : null;
  }

  listGaps(sessionId: number, status?: GapStatus[]): Gap[] {
    if (status && status.length > 0) {
      const placeholders = status.map(() => '?').join(',');
      const rows = this.db
        .prepare(
          `SELECT * FROM gaps WHERE session_id = ? AND status IN (${placeholders})
           ORDER BY created_at ASC`,
        )
        .all(sessionId, ...status) as GapRow[];
      return rows.map(gapFromRow);
    }
    const rows = this.db
      .prepare('SELECT * FROM gaps WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as GapRow[];
    return rows.map(gapFromRow);
  }

  transitionGap(gapId: number, to: GapStatus): void {
    const row = this.db.prepare('SELECT status FROM gaps WHERE id = ?').get(gapId) as
      | { status: GapStatus }
      | undefined;
    if (!row) throw new Error(`gap ${gapId} not found`);
    assertGapTransition(row.status, to);
    const isTerminal = to === 'DONE' || to === 'SKIPPED' || to === 'NEED_HUMAN' || to === 'SPLIT_DONE';
    if (isTerminal) {
      this.db
        .prepare('UPDATE gaps SET status = ?, finished_at = ? WHERE id = ?')
        .run(to, Date.now(), gapId);
    } else {
      this.db.prepare('UPDATE gaps SET status = ? WHERE id = ?').run(to, gapId);
    }
  }

  setGapDynamicK(gapId: number, k: number): void {
    this.db.prepare('UPDATE gaps SET dynamic_k = ? WHERE id = ?').run(k, gapId);
  }

  doneGapHistory(sessionId: number): { slug: string; title: string; status: GapStatus }[] {
    return this.db
      .prepare(
        `SELECT slug, title, status FROM gaps WHERE session_id = ?
         AND status IN ('DONE','SKIPPED','NEED_HUMAN','SPLIT_DONE')`,
      )
      .all(sessionId) as { slug: string; title: string; status: GapStatus }[];
  }

  // ─── fixes ─────────────────────────────────────────────────────────────

  nextAttemptNumber(gapId: number): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(attempt), 0) + 1 AS next FROM fixes WHERE gap_id = ?')
      .get(gapId) as { next: number };
    return row.next;
  }

  // ─── log_events ────────────────────────────────────────────────────────

  insertLogEvent(
    sessionId: number,
    level: 'info' | 'warn' | 'error',
    kind: string,
    payload: Record<string, unknown>,
  ): LogEvent {
    const now = Date.now();
    const result = this.db
      .prepare(
        `INSERT INTO log_events(session_id, ts, level, kind, payload_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sessionId, now, level, kind, JSON.stringify(payload));
    return {
      id: result.lastInsertRowid as number,
      sessionId,
      ts: now,
      level,
      kind: kind as LogEvent['kind'],
      payload,
    };
  }

  recentLogEvents(sessionId: number, limit = 100): LogEvent[] {
    interface Row {
      id: number;
      session_id: number;
      ts: number;
      level: 'info' | 'warn' | 'error';
      kind: string;
      payload_json: string;
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM log_events WHERE session_id = ?
         ORDER BY ts DESC LIMIT ?`,
      )
      .all(sessionId, limit) as Row[];
    return rows.reverse().map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      ts: r.ts,
      level: r.level,
      kind: r.kind as LogEvent['kind'],
      payload: JSON.parse(r.payload_json) as Record<string, unknown>,
    }));
  }

  // ─── preset status ─────────────────────────────────────────────────────

  setPresetStatus(sessionId: number, status: PresetStatusItem[]): void {
    this.db
      .prepare('INSERT INTO preset_status_history(session_id, ts, status_json) VALUES (?, ?, ?)')
      .run(sessionId, Date.now(), JSON.stringify(status));
  }

  latestPresetStatus(sessionId: number): PresetStatusItem[] {
    const row = this.db
      .prepare(
        `SELECT status_json FROM preset_status_history
         WHERE session_id = ? ORDER BY ts DESC LIMIT 1`,
      )
      .get(sessionId) as { status_json: string } | undefined;
    if (!row) return [];
    return JSON.parse(row.status_json) as PresetStatusItem[];
  }

  isPresetAllDone(sessionId: number): boolean {
    const items = this.latestPresetStatus(sessionId);
    if (items.length === 0) return false;
    return items.every((i) => i.status === 'done');
  }

  // ─── cost totals ───────────────────────────────────────────────────────

  costTotals(sessionId: number, perMtokPricing: Record<string, { input: number; output: number }>): CostTotals {
    interface Row {
      role: string;
      model: string;
      in_tok: number | null;
      out_tok: number | null;
    }
    const rows = this.db
      .prepare(
        `SELECT role, model, SUM(input_tokens) AS in_tok, SUM(output_tokens) AS out_tok
         FROM cost_records WHERE session_id = ? GROUP BY role, model`,
      )
      .all(sessionId) as Row[];
    let inputTokens = 0;
    let outputTokens = 0;
    let estimatedUsd = 0;
    for (const r of rows) {
      const i = r.in_tok ?? 0;
      const o = r.out_tok ?? 0;
      inputTokens += i;
      outputTokens += o;
      const p = perMtokPricing[r.model];
      if (p) {
        estimatedUsd += (i * p.input + o * p.output) / 1_000_000;
      }
    }
    return { inputTokens, outputTokens, estimatedUsd };
  }

  insertCostRecord(
    sessionId: number,
    role: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO cost_records(session_id, role, model, input_tokens, output_tokens, ts)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(sessionId, role, model, inputTokens, outputTokens, Date.now());
  }
}
