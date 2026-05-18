import type Database from 'better-sqlite3';
import type {
  Demo,
  Session,
  Gap,
  Fix,
  FixStatus,
  LogEvent,
  SessionStatus,
  GapStatus,
  PresetStatusItem,
  CostTotals,
  ProjectType,
  ReviewKind,
  ClaudeModel,
  Verdict,
  ReasonCode,
  SplitGapSpec,
  VisionDraft,
} from '../types.js';
import { asAbsPath } from '../util/path.js';
import {
  assertFixTransition,
  assertGapTransition,
  assertSessionTransition,
} from '../state/transitions.js';

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
  mode?: 'local-merge' | 'github-pr';
  github_repo?: string | null;
  base_branch?: string;
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
  complexity: 'simple' | 'complex';
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
    mode: (r.mode ?? 'local-merge') as Session['mode'],
    githubRepo: r.github_repo ?? null,
    baseBranch: r.base_branch ?? 'main',
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
    complexity: (r.complexity ?? 'simple') as Gap['complexity'],
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

  getDemo(id: number): Demo | null {
    const row = this.db.prepare('SELECT * FROM demos WHERE id = ?').get(id) as DemoRow | undefined;
    return row ? demoFromRow(row) : null;
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

  /** Most recently started session, regardless of status. */
  getLatestSession(): Session | null {
    const row = this.db
      .prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT 1')
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

  setSessionMode(
    sessionId: number,
    mode: 'local-merge' | 'github-pr',
    githubRepo: string | null,
    baseBranch: string,
  ): void {
    this.db
      .prepare('UPDATE sessions SET mode = ?, github_repo = ?, base_branch = ? WHERE id = ?')
      .run(mode, githubRepo, baseBranch, sessionId);
  }

  setFixPR(fixId: number, prNumber: number, prUrl: string): void {
    this.db
      .prepare('UPDATE fixes SET pr_number = ?, pr_url = ? WHERE id = ?')
      .run(prNumber, prUrl, fixId);
  }

  // ─── gaps ──────────────────────────────────────────────────────────────

  insertGap(
    input: Omit<Gap, 'id' | 'createdAt' | 'finishedAt' | 'status' | 'dynamicK' | 'complexity'> & {
      complexity?: 'simple' | 'complex';
    },
  ): Gap {
    const now = Date.now();
    const result = this.db
      .prepare(
        `INSERT INTO gaps(session_id, slug, title, body, category, severity, source,
                          suggested_approach, expected_files_changed, status,
                          parent_gap_id, created_at, complexity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
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
        input.complexity ?? 'simple',
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

  setGapComplexity(gapId: number, complexity: 'simple' | 'complex'): void {
    this.db.prepare('UPDATE gaps SET complexity = ? WHERE id = ?').run(complexity, gapId);
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

  insertFix(input: {
    gapId: number;
    attempt: number;
    branch: string;
    worktreePath: string;
  }): Fix {
    const now = Date.now();
    const result = this.db
      .prepare(
        `INSERT INTO fixes(gap_id, attempt, branch, worktree_path, status, created_at, files_changed)
         VALUES (?, ?, ?, ?, 'STARTED', ?, ?)`,
      )
      .run(input.gapId, input.attempt, input.branch, input.worktreePath, now, JSON.stringify([]));
    return this.getFix(result.lastInsertRowid as number)!;
  }

  getFix(id: number): Fix | null {
    interface Row {
      id: number;
      gap_id: number;
      attempt: number;
      branch: string;
      worktree_path: string;
      commit_sha: string | null;
      static_gate_passed: number | null;
      alignment_score: number | null;
      reviewer_verdict: string | null;
      reason_code: string | null;
      status: FixStatus;
      stderr_excerpt: string | null;
      files_changed: string | null;
      confidence: number | null;
      pr_number?: number | null;
      pr_url?: string | null;
      created_at: number;
      finished_at: number | null;
    }
    const row = this.db.prepare('SELECT * FROM fixes WHERE id = ?').get(id) as Row | undefined;
    if (!row) return null;
    return {
      id: row.id,
      gapId: row.gap_id,
      attempt: row.attempt,
      branch: row.branch,
      worktreePath: row.worktree_path as unknown as Fix['worktreePath'],
      commitSha: row.commit_sha,
      staticGatePassed: row.static_gate_passed === null ? null : row.static_gate_passed === 1,
      alignmentScore: row.alignment_score,
      reviewerVerdict: row.reviewer_verdict as Verdict | null,
      reasonCode: row.reason_code as ReasonCode | null,
      status: row.status,
      stderrExcerpt: row.stderr_excerpt,
      filesChanged: row.files_changed ? (JSON.parse(row.files_changed) as string[]) : [],
      confidence: row.confidence,
      prNumber: row.pr_number ?? null,
      prUrl: row.pr_url ?? null,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
    };
  }

  transitionFix(fixId: number, to: FixStatus, fields: Partial<Fix> = {}): void {
    const current = this.getFix(fixId);
    if (!current) throw new Error(`fix ${fixId} not found`);
    assertFixTransition(current.status, to);
    const isTerminal = to === 'MERGED' || to === 'DROPPED';
    const sets: string[] = ['status = ?'];
    const values: unknown[] = [to];

    if (fields.commitSha !== undefined) {
      sets.push('commit_sha = ?');
      values.push(fields.commitSha);
    }
    if (fields.staticGatePassed !== undefined) {
      sets.push('static_gate_passed = ?');
      values.push(fields.staticGatePassed === null ? null : fields.staticGatePassed ? 1 : 0);
    }
    if (fields.alignmentScore !== undefined) {
      sets.push('alignment_score = ?');
      values.push(fields.alignmentScore);
    }
    if (fields.reviewerVerdict !== undefined) {
      sets.push('reviewer_verdict = ?');
      values.push(fields.reviewerVerdict);
    }
    if (fields.reasonCode !== undefined) {
      sets.push('reason_code = ?');
      values.push(fields.reasonCode);
    }
    if (fields.stderrExcerpt !== undefined) {
      sets.push('stderr_excerpt = ?');
      values.push(fields.stderrExcerpt);
    }
    if (fields.filesChanged !== undefined) {
      sets.push('files_changed = ?');
      values.push(JSON.stringify(fields.filesChanged));
    }
    if (fields.confidence !== undefined) {
      sets.push('confidence = ?');
      values.push(fields.confidence);
    }
    if (isTerminal) {
      sets.push('finished_at = ?');
      values.push(Date.now());
    }

    values.push(fixId);
    this.db.prepare(`UPDATE fixes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  // ─── reviews ───────────────────────────────────────────────────────────

  insertReview(input: {
    fixId: number;
    kind: ReviewKind;
    model: ClaudeModel;
    verdict: Verdict | null;
    hints: string[];
    reasonCode: ReasonCode | null;
    difficulty: number | null;
    splitInto: SplitGapSpec[] | null;
    rawJson: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO reviews(fix_id, kind, model, verdict, hints, reason_code, difficulty, split_into, raw_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.fixId,
        input.kind,
        input.model,
        input.verdict,
        JSON.stringify(input.hints),
        input.reasonCode,
        input.difficulty,
        input.splitInto ? JSON.stringify(input.splitInto) : null,
        input.rawJson,
        Date.now(),
      );
  }

  // ─── vision drafts ─────────────────────────────────────────────────────

  upsertVisionDraft(input: {
    sessionId: number;
    roundIndex: number;
    questionId: string;
    question: string;
    answer: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO vision_drafts(session_id, round_index, question_id, question, answer, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, question_id) DO UPDATE SET
           round_index = excluded.round_index,
           question = excluded.question,
           answer = excluded.answer`,
      )
      .run(input.sessionId, input.roundIndex, input.questionId, input.question, input.answer, Date.now());
  }

  listVisionDrafts(sessionId: number): VisionDraft[] {
    interface Row {
      id: number;
      session_id: number;
      round_index: number;
      question_id: string;
      question: string;
      answer: string;
      created_at: number;
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM vision_drafts WHERE session_id = ?
         ORDER BY round_index, created_at`,
      )
      .all(sessionId) as Row[];
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      roundIndex: r.round_index,
      questionId: r.question_id,
      question: r.question,
      answer: r.answer,
      createdAt: r.created_at,
    }));
  }

  maxVisionRound(sessionId: number): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(round_index), 0) AS r FROM vision_drafts WHERE session_id = ?`,
      )
      .get(sessionId) as { r: number };
    return row.r;
  }

  // ─── repo summaries cache ──────────────────────────────────────────────

  putRepoSummary(sessionId: number, headSha: string | null, summaryJson: string): void {
    this.db
      .prepare(
        `INSERT INTO repo_summaries(session_id, ts, head_sha, summary_json) VALUES (?, ?, ?, ?)`,
      )
      .run(sessionId, Date.now(), headSha, summaryJson);
  }

  latestRepoSummary(sessionId: number): { ts: number; headSha: string | null; json: string } | null {
    const row = this.db
      .prepare(
        `SELECT ts, head_sha, summary_json FROM repo_summaries
         WHERE session_id = ? ORDER BY ts DESC LIMIT 1`,
      )
      .get(sessionId) as { ts: number; head_sha: string | null; summary_json: string } | undefined;
    if (!row) return null;
    return { ts: row.ts, headSha: row.head_sha, json: row.summary_json };
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
    engine: string = '',
    cacheReadTokens: number = 0,
    cacheWriteTokens: number = 0,
  ): void {
    this.db
      .prepare(
        `INSERT INTO cost_records(session_id, role, model, input_tokens, output_tokens, engine, cache_read_tokens, cache_write_tokens, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId, role, model, inputTokens, outputTokens,
        engine, cacheReadTokens, cacheWriteTokens, Date.now(),
      );
  }

  /** F4 — per-(role × engine) rollup for Mission Control attribution panel. */
  costAttribution(
    sessionId: number,
    perMtokPricing: Record<string, { input: number; output: number }>,
  ): CostBucket[] {
    interface Row {
      role: string;
      model: string;
      engine: string;
      in_tok: number | null;
      out_tok: number | null;
      cache_in: number | null;
      cache_out: number | null;
    }
    const rows = this.db
      .prepare(
        `SELECT role, model, engine,
                SUM(input_tokens)      AS in_tok,
                SUM(output_tokens)     AS out_tok,
                SUM(cache_read_tokens) AS cache_in,
                SUM(cache_write_tokens) AS cache_out
         FROM cost_records WHERE session_id = ? GROUP BY role, engine, model
         ORDER BY in_tok DESC`,
      )
      .all(sessionId) as Row[];
    return rows.map((r) => {
      const i = r.in_tok ?? 0;
      const o = r.out_tok ?? 0;
      const p = perMtokPricing[r.model];
      const usd = p ? (i * p.input + o * p.output) / 1_000_000 : 0;
      return {
        role: r.role,
        engine: r.engine,
        model: r.model,
        inputTokens: i,
        outputTokens: o,
        cacheReadTokens: r.cache_in ?? 0,
        cacheWriteTokens: r.cache_out ?? 0,
        estimatedUsd: usd,
      };
    });
  }
}

export interface CostBucket {
  role: string;
  engine: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedUsd: number;
}
