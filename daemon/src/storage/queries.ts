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
  AgentSessionAgg,
  AgentRoleStatus,
  MergedCommitRow,
  PresetRichRow,
  ClaudeRole,
  CommitRisk,
  RiskBand,
  MilestoneRow,
  MilestoneStatus,
  ResumeMark,
  ProjectListItem,
  SessionListItem,
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

  // ─── aggregation queries (Worker-A real-backend wire) ────────────────────

  /**
   * Roll log_events up by ClaudeRole to produce the SessionsBoard agent rows.
   * Heuristic: last AGENT_START with a role field determines currentGapSlug
   * if the gap is still IN_PROGRESS. AGENT_END / REVIEW_VERDICT / MERGED /
   * GAP_DONE => idle/done. No recent event (>5 min) => stale.
   */
  aggregateSessionsByRole(sessionId: number): AgentSessionAgg[] {
    interface EventRow {
      id: number;
      ts: number;
      kind: string;
      payload_json: string;
    }

    const roles: ClaudeRole[] = [
      'differ',
      'implementer',
      'alignment',
      'behavioral',
      'adversarial',
      'done-check',
      'repo-summary',
    ];

    // Fetch all log_events for this session ordered ascending
    const events = (
      this.db
        .prepare(
          `SELECT id, ts, kind, payload_json FROM log_events
           WHERE session_id = ? ORDER BY ts ASC`,
        )
        .all(sessionId) as EventRow[]
    ).map((r) => ({
      id: r.id,
      ts: r.ts,
      kind: r.kind,
      payload: JSON.parse(r.payload_json) as Record<string, unknown>,
    }));

    const now = Date.now();
    const STALE_MS = 5 * 60_000; // 5 minutes

    // Build per-role state by scanning events
    const state = new Map<
      ClaudeRole,
      {
        lastActivityTs: number | null;
        callsThisSession: number;
        turnCountThisGap: number;
        currentGapSlug: string | null;
        status: AgentRoleStatus;
        lastTurnSummary: string | null;
      }
    >();

    for (const role of roles) {
      state.set(role, {
        lastActivityTs: null,
        callsThisSession: 0,
        turnCountThisGap: 0,
        currentGapSlug: null,
        status: 'idle',
        lastTurnSummary: null,
      });
    }

    for (const ev of events) {
      const role = (ev.payload['role'] as ClaudeRole | undefined);

      if (ev.kind === 'AGENT_START' && role && state.has(role)) {
        const s = state.get(role)!;
        s.callsThisSession += 1;
        s.lastActivityTs = ev.ts;
        s.status = 'working';
        s.currentGapSlug = (ev.payload['gapSlug'] as string | undefined) ?? s.currentGapSlug;
        const thought = ev.payload['thought'] as string | undefined;
        s.lastTurnSummary = thought ?? `${role} agent started`;
      } else if (ev.kind === 'AGENT_THOUGHT' && role && state.has(role)) {
        const s = state.get(role)!;
        s.lastActivityTs = ev.ts;
        s.turnCountThisGap += 1;
        const thought = ev.payload['text'] as string | undefined;
        if (thought) s.lastTurnSummary = thought.slice(0, 200);
      } else if (ev.kind === 'AGENT_END' && role && state.has(role)) {
        const s = state.get(role)!;
        s.lastActivityTs = ev.ts;
        s.status = 'idle';
      } else if (ev.kind === 'REVIEW_VERDICT' && role && state.has(role)) {
        const s = state.get(role)!;
        s.lastActivityTs = ev.ts;
        s.status = 'idle';
        const verdict = ev.payload['verdict'] as string | undefined;
        if (verdict) s.lastTurnSummary = `verdict: ${verdict}`;
      } else if (ev.kind === 'GAP_DONE' || ev.kind === 'GAP_SKIPPED') {
        // Reset all roles' turnCountThisGap on gap completion
        for (const s of state.values()) {
          s.turnCountThisGap = 0;
          if (s.currentGapSlug === (ev.payload['slug'] as string | undefined)) {
            s.currentGapSlug = null;
            if (s.status === 'working') s.status = 'idle';
          }
        }
      } else if (ev.kind === 'SESSION_DONE') {
        for (const s of state.values()) {
          s.status = 'done';
        }
      } else if (ev.kind === 'GAP_PICKED') {
        const slug = ev.payload['slug'] as string | undefined;
        if (slug) {
          // Mark the implementer's current gap
          const impl = state.get('implementer');
          if (impl) impl.currentGapSlug = slug;
        }
      } else if (ev.kind === 'MERGED') {
        // After a merge, mark implementer idle
        const impl = state.get('implementer');
        if (impl) {
          impl.lastActivityTs = ev.ts;
          impl.status = 'idle';
        }
      }
    }

    // Lookup gap titles for current slugs
    const slugTitleCache = new Map<string, string>();
    for (const s of state.values()) {
      if (s.currentGapSlug && !slugTitleCache.has(s.currentGapSlug)) {
        const gapRow = this.db
          .prepare('SELECT title FROM gaps WHERE session_id = ? AND slug = ?')
          .get(sessionId, s.currentGapSlug) as { title: string } | undefined;
        if (gapRow) slugTitleCache.set(s.currentGapSlug, gapRow.title);
      }
    }

    return roles.map((role) => {
      const s = state.get(role)!;
      // Stale check: working but no activity for >5 min
      let status = s.status;
      if (status === 'working' && s.lastActivityTs !== null && now - s.lastActivityTs > STALE_MS) {
        status = 'stale';
      }
      const currentGapTitle = s.currentGapSlug ? (slugTitleCache.get(s.currentGapSlug) ?? null) : null;
      return {
        role,
        status,
        currentGapSlug: s.currentGapSlug,
        currentGapTitle,
        lastTurnSummary: s.lastTurnSummary,
        turnCountThisGap: s.turnCountThisGap,
        callsThisSession: s.callsThisSession,
        lastActivityTs: s.lastActivityTs,
      };
    });
  }

  /**
   * List merged commits for CommitsTimeline. JOINs fixes + gaps + reviews.
   * insertions/deletions are always 0 (git-diff parsing is out of scope).
   */
  listMergedCommits(sessionId: number, limit = 50): MergedCommitRow[] {
    interface FixRow {
      fix_id: number;
      commit_sha: string | null;
      files_changed: string | null;
      finished_at: number | null;
      created_at: number;
      gap_slug: string;
      gap_title: string;
    }
    const clampedLimit = Math.min(limit, 200);

    const fixes = this.db
      .prepare(
        `SELECT f.id AS fix_id, f.commit_sha, f.files_changed, f.finished_at, f.created_at,
                g.slug AS gap_slug, g.title AS gap_title
         FROM fixes f
         JOIN gaps g ON g.id = f.gap_id
         WHERE g.session_id = ? AND f.status = 'MERGED'
         ORDER BY COALESCE(f.finished_at, f.created_at) DESC
         LIMIT ?`,
      )
      .all(sessionId, clampedLimit) as FixRow[];

    return fixes.map((fix) => {
      const filesArr = fix.files_changed ? (JSON.parse(fix.files_changed) as string[]) : [];

      // Fetch reviews for this fix
      interface ReviewRow {
        kind: ReviewKind;
        verdict: string | null;
        difficulty: number | null;
      }
      const reviews = this.db
        .prepare(
          `SELECT kind, verdict, difficulty FROM reviews WHERE fix_id = ?`,
        )
        .all(fix.fix_id) as ReviewRow[];

      const sha = fix.commit_sha;
      const shortSha = sha ? sha.slice(0, 8) : null;
      const ts = fix.finished_at ?? fix.created_at;

      return {
        sha,
        shortSha,
        ts,
        gapSlug: fix.gap_slug,
        gapTitle: fix.gap_title,
        filesChanged: filesArr.length,
        insertions: 0,
        deletions: 0,
        message: fix.gap_title,
        reviewVerdicts: reviews.map((r) => ({
          kind: r.kind as ReviewKind,
          verdict: r.verdict as Verdict | null,
          score: r.difficulty,
        })),
      };
    });
  }

  /**
   * Produce the 32-item rich preset checklist for the session.
   * Reads latest preset_status_history snapshot and merges with PRESET_META_32.
   * Items not in preset_status_history default to status='missing'.
   */
  listPresetRich(sessionId: number): PresetRichRow[] {
    const latest = this.latestPresetStatus(sessionId);

    // Build lookup by item id
    const statusMap = new Map<string, { status: 'done' | 'partial' | 'missing'; note: string | null }>();
    for (const item of latest) {
      statusMap.set(item.item, { status: item.status, note: item.note });
    }

    return PRESET_META_32.map((meta) => {
      const stored = statusMap.get(meta.id);
      return {
        id: meta.id,
        label: meta.label,
        severity: meta.severity,
        mechanism: meta.mechanism,
        source: meta.source,
        appliesTo: meta.appliesTo,
        status: stored?.status ?? 'missing',
        note: stored?.note ?? null,
      };
    });
  }

  // ─── commit_risk ──────────────────────────────────────────────────────────

  setCommitRisk(sha: string, risk: CommitRisk): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO commit_risk(sha, band, score, reasons_json, review_hunks_json, ts)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(sha) DO UPDATE SET
           band = excluded.band,
           score = excluded.score,
           reasons_json = excluded.reasons_json,
           review_hunks_json = excluded.review_hunks_json,
           ts = excluded.ts`,
      )
      .run(sha, risk.band, risk.score, JSON.stringify(risk.reasons), JSON.stringify(risk.reviewHunks), now);
  }

  getCommitRisk(sha: string): CommitRisk | null {
    interface Row {
      band: RiskBand;
      score: number;
      reasons_json: string;
      review_hunks_json: string;
    }
    const row = this.db
      .prepare('SELECT band, score, reasons_json, review_hunks_json FROM commit_risk WHERE sha = ?')
      .get(sha) as Row | undefined;
    if (!row) return null;
    return {
      band: row.band,
      score: row.score,
      reasons: JSON.parse(row.reasons_json) as string[],
      reviewHunks: JSON.parse(row.review_hunks_json) as CommitRisk['reviewHunks'],
    };
  }

  // ─── milestones ───────────────────────────────────────────────────────────

  listMilestones(sessionId: number): MilestoneRow[] {
    interface Row {
      id: number;
      session_id: number;
      title: string;
      vision_excerpt: string | null;
      preset_item_ids_json: string;
      status: MilestoneStatus;
      ordinal: number;
      completed_at: number | null;
    }
    const rows = this.db
      .prepare('SELECT * FROM milestones WHERE session_id = ? ORDER BY ordinal ASC')
      .all(sessionId) as Row[];
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      title: r.title,
      visionExcerpt: r.vision_excerpt,
      presetItemIds: JSON.parse(r.preset_item_ids_json) as string[],
      status: r.status,
      ordinal: r.ordinal,
      completedAt: r.completed_at,
    }));
  }

  upsertMilestone(args: {
    id?: number;
    sessionId: number;
    title: string;
    visionExcerpt?: string | null;
    presetItemIds?: string[];
    status?: MilestoneStatus;
    ordinal?: number;
    completedAt?: number | null;
  }): MilestoneRow {
    if (args.id !== undefined) {
      // Update existing
      const sets: string[] = [];
      const vals: unknown[] = [];
      if (args.title !== undefined) { sets.push('title = ?'); vals.push(args.title); }
      if (args.visionExcerpt !== undefined) { sets.push('vision_excerpt = ?'); vals.push(args.visionExcerpt); }
      if (args.presetItemIds !== undefined) { sets.push('preset_item_ids_json = ?'); vals.push(JSON.stringify(args.presetItemIds)); }
      if (args.status !== undefined) { sets.push('status = ?'); vals.push(args.status); }
      if (args.ordinal !== undefined) { sets.push('ordinal = ?'); vals.push(args.ordinal); }
      if (args.completedAt !== undefined) { sets.push('completed_at = ?'); vals.push(args.completedAt); }
      if (sets.length > 0) {
        vals.push(args.id);
        this.db.prepare(`UPDATE milestones SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      }
      return this.getMilestone(args.id)!;
    }
    // Insert new
    const result = this.db
      .prepare(
        `INSERT INTO milestones(session_id, title, vision_excerpt, preset_item_ids_json, status, ordinal)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        args.sessionId,
        args.title,
        args.visionExcerpt ?? null,
        JSON.stringify(args.presetItemIds ?? []),
        args.status ?? 'pending',
        args.ordinal ?? 0,
      );
    return this.getMilestone(result.lastInsertRowid as number)!;
  }

  getMilestone(id: number): MilestoneRow | null {
    interface Row {
      id: number;
      session_id: number;
      title: string;
      vision_excerpt: string | null;
      preset_item_ids_json: string;
      status: MilestoneStatus;
      ordinal: number;
      completed_at: number | null;
    }
    const row = this.db.prepare('SELECT * FROM milestones WHERE id = ?').get(id) as Row | undefined;
    if (!row) return null;
    return {
      id: row.id,
      sessionId: row.session_id,
      title: row.title,
      visionExcerpt: row.vision_excerpt,
      presetItemIds: JSON.parse(row.preset_item_ids_json) as string[],
      status: row.status,
      ordinal: row.ordinal,
      completedAt: row.completed_at,
    };
  }

  // ─── session_resume_marks ─────────────────────────────────────────────────

  markSessionPause(
    sessionId: number,
    gapId: number | null,
    runId: string | null,
  ): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO session_resume_marks(session_id, last_seen_ts, gap_id_at_pause, run_id_at_pause)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           last_seen_ts = excluded.last_seen_ts,
           gap_id_at_pause = excluded.gap_id_at_pause,
           run_id_at_pause = excluded.run_id_at_pause`,
      )
      .run(sessionId, now, gapId, runId);
  }

  loadResumeMark(sessionId: number): ResumeMark | null {
    interface Row {
      session_id: number;
      last_seen_ts: number;
      gap_id_at_pause: number | null;
      run_id_at_pause: string | null;
    }
    const row = this.db
      .prepare('SELECT * FROM session_resume_marks WHERE session_id = ?')
      .get(sessionId) as Row | undefined;
    if (!row) return null;
    return {
      sessionId: row.session_id,
      lastSeenTs: row.last_seen_ts,
      gapIdAtPause: row.gap_id_at_pause,
      runIdAtPause: row.run_id_at_pause,
    };
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

  // ─── multi-project list ─────────────────────────────────────────────────

  /**
   * All registered demos with their session counts and latest session pointer.
   * Backs the ProjectsHome page. Derived counts (agents working, preset done,
   * cost, last commit) are computed best-effort from the latest session.
   */
  listProjects(
    perMtokPricing: Record<string, { input: number; output: number }>,
  ): ProjectListItem[] {
    interface Row {
      id: number;
      path: string;
      first_seen_at: number;
      last_session_at: number | null;
      inferred_type: string | null;
      total_sessions: number;
      latest_session_id: number | null;
      latest_session_status: SessionStatus | null;
    }
    const rows = this.db
      .prepare(
        `SELECT d.id, d.path, d.first_seen_at, d.last_session_at, d.inferred_type,
                COUNT(s.id) AS total_sessions,
                (SELECT id FROM sessions WHERE demo_id = d.id ORDER BY started_at DESC LIMIT 1) AS latest_session_id,
                (SELECT status FROM sessions WHERE demo_id = d.id ORDER BY started_at DESC LIMIT 1) AS latest_session_status
         FROM demos d LEFT JOIN sessions s ON s.demo_id = d.id
         GROUP BY d.id
         ORDER BY COALESCE(d.last_session_at, d.first_seen_at) DESC`,
      )
      .all() as Row[];

    return rows.map((r) => {
      const parts = r.path.replace(/[/\\]+$/, '').split(/[/\\]/);
      const name = parts[parts.length - 1] || r.path;

      let agentsWorking = 0;
      let agentsTotal = 0;
      let presetDone = 0;
      let presetTotal = 0;
      let visionVerdict: ProjectListItem['visionVerdict'] = 'pending';
      let lastCommitTs: number | null = null;
      let lastCommitMsg: string | null = null;
      let estimatedUsd = 0;

      const sid = r.latest_session_id;
      if (sid !== null) {
        const agentRows = this.aggregateSessionsByRole(sid);
        agentsTotal = agentRows.length;
        agentsWorking = agentRows.filter((a) => a.status === 'working').length;

        const presetRows = this.latestPresetStatus(sid);
        presetTotal = presetRows.length;
        presetDone = presetRows.filter((p) => p.status === 'done').length;

        if (r.latest_session_status === 'DONE') {
          visionVerdict = presetTotal > 0 && presetDone === presetTotal ? 'yes' : 'partial';
        } else if (presetTotal > 0 && presetDone > 0) {
          visionVerdict = 'partial';
        }

        const merged = this.listMergedCommits(sid, 1);
        const top = merged[0];
        if (top) {
          lastCommitTs = top.ts;
          lastCommitMsg = top.message;
        }

        estimatedUsd = this.costTotals(sid, perMtokPricing).estimatedUsd;
      }

      return {
        id: r.id,
        path: r.path,
        name,
        inferredType: r.inferred_type as ProjectType | null,
        firstSeenAt: r.first_seen_at,
        lastSessionAt: r.last_session_at,
        totalSessions: r.total_sessions,
        latestSessionId: r.latest_session_id,
        latestSessionStatus: r.latest_session_status,
        agentsWorking,
        agentsTotal,
        presetDone,
        presetTotal,
        visionVerdict,
        lastCommitTs,
        lastCommitMsg,
        estimatedUsd,
      };
    });
  }

  /**
   * Sessions for a given demo with derived counts (commits via fixes, agent
   * calls via AGENT_START events, top risk band).
   */
  listSessionsByDemo(demoId: number): SessionListItem[] {
    interface Row {
      id: number;
      started_at: number;
      ended_at: number | null;
      status: SessionStatus;
      preset_type: string | null;
    }
    const sessions = this.db
      .prepare(
        `SELECT id, started_at, ended_at, status, preset_type
         FROM sessions WHERE demo_id = ? ORDER BY started_at DESC`,
      )
      .all(demoId) as Row[];

    const commitsCountStmt = this.db.prepare(
      `SELECT COUNT(*) AS n FROM fixes f JOIN gaps g ON g.id = f.gap_id
       WHERE g.session_id = ? AND f.status = 'MERGED' AND f.commit_sha IS NOT NULL`,
    );
    const callsCountStmt = this.db.prepare(
      `SELECT COUNT(*) AS n FROM log_events WHERE session_id = ? AND kind = 'AGENT_START'`,
    );
    const topRiskStmt = this.db.prepare(
      `SELECT cr.band FROM commit_risk cr
       JOIN fixes f ON f.commit_sha = cr.sha
       JOIN gaps g ON g.id = f.gap_id
       WHERE g.session_id = ?
       ORDER BY CASE cr.band WHEN 'high' THEN 0 WHEN 'mid' THEN 1 ELSE 2 END
       LIMIT 1`,
    );

    return sessions.map((r) => {
      const commitsCount = (commitsCountStmt.get(r.id) as { n: number }).n;
      const agentCalls = (callsCountStmt.get(r.id) as { n: number }).n;
      const topRiskRow = topRiskStmt.get(r.id) as { band: RiskBand } | undefined;
      return {
        id: r.id,
        startedAt: r.started_at,
        endedAt: r.ended_at,
        status: r.status,
        presetType: r.preset_type as ProjectType | null,
        commitsCount,
        agentCalls,
        topRisk: topRiskRow ? topRiskRow.band : null,
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

// ─── 32-item preset meta (source of truth: ui/src/mock/data.ts mockPresetItemsRich) ──
interface PresetMeta {
  id: string;
  label: string;
  severity: 'P1' | 'P2' | 'P3';
  mechanism: 'static-grep' | 'file-exists' | 'test-execution' | 'cross-file-cohesion' | 'llm-judgment';
  source: string;
  appliesTo: string[];
}

export const PRESET_META_32: PresetMeta[] = [
  { id: 'build-typecheck',         label: 'Typecheck / compile passes clean',          severity: 'P1', mechanism: 'test-execution',      source: 'base',           appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'build-reproducible',      label: 'Build command exits 0 on clean checkout',   severity: 'P1', mechanism: 'test-execution',      source: '12F-V',          appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'test-runner-present',     label: 'Test runner configured + ≥1 test file',     severity: 'P1', mechanism: 'file-exists',         source: 'base',           appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'test-happy-path-passes',  label: 'npm test exits 0',                           severity: 'P1', mechanism: 'test-execution',      source: 'base',           appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'test-edge-cases',         label: '≥1 negative test per public function',      severity: 'P2', mechanism: 'llm-judgment',        source: 'base',           appliesTo: ['L','A','C','ML'] },
  { id: 'readme-quickstart',       label: 'README has fenced install + run block',     severity: 'P1', mechanism: 'static-grep',         source: 'base',           appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'license-file',            label: 'LICENSE present + SPDX-recognized',         severity: 'P1', mechanism: 'file-exists',         source: 'OpenSSF',        appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'env-example',             label: '.env.example covers every env var read',    severity: 'P1', mechanism: 'cross-file-cohesion', source: '12F-III',        appliesTo: ['W','A'] },
  { id: 'no-hardcoded-secrets',    label: 'No hardcoded API keys / passwords',         severity: 'P1', mechanism: 'static-grep',         source: 'OWASP-A02:2025', appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'lockfile-present',        label: 'Dependency lockfile committed',             severity: 'P1', mechanism: 'file-exists',         source: 'OpenSSF',        appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'deps-no-high-vuln',       label: 'npm audit / pip-audit · 0 high',            severity: 'P1', mechanism: 'test-execution',      source: 'OWASP-A03:2025', appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'port-from-env',           label: 'Server reads PORT from env',                severity: 'P1', mechanism: 'static-grep',         source: '12F-VII',        appliesTo: ['W','A'] },
  { id: 'sigterm-handler',         label: 'Graceful shutdown on SIGTERM',              severity: 'P2', mechanism: 'static-grep',         source: '12F-IX',         appliesTo: ['W','A','D'] },
  { id: 'stdout-logging',          label: 'Logs go to stdout (not files)',             severity: 'P2', mechanism: 'static-grep',         source: '12F-XI',         appliesTo: ['W','A','C'] },
  { id: 'health-endpoint',         label: 'GET /health returns 200',                   severity: 'P1', mechanism: 'static-grep',         source: 'SRE',            appliesTo: ['W','A'] },
  { id: 'structured-logs',         label: 'Logs parseable JSON / carry request id',    severity: 'P2', mechanism: 'cross-file-cohesion', source: 'SRE',            appliesTo: ['W','A'] },
  { id: 'error-handler-present',   label: 'Top-level error handler / boundary',        severity: 'P2', mechanism: 'llm-judgment',        source: 'OWASP-A10:2025', appliesTo: ['W','A','D'] },
  { id: 'auth-on-mutating-routes', label: 'Non-GET routes covered by auth',            severity: 'P1', mechanism: 'llm-judgment',        source: 'OWASP-A01:2025', appliesTo: ['W','A'] },
  { id: 'password-hash-strong',    label: 'bcrypt / argon2 / scrypt only',             severity: 'P1', mechanism: 'static-grep',         source: 'OWASP-A04:2025', appliesTo: ['W','A'] },
  { id: 'https-only-prod',         label: 'No http:// in prod config · cookies Secure', severity: 'P1', mechanism: 'static-grep',        source: 'OWASP-A02:2025', appliesTo: ['W','A'] },
  { id: 'rate-limit-public',       label: 'Public routes wrapped in rate-limit',       severity: 'P2', mechanism: 'static-grep',         source: 'base',           appliesTo: ['W','A'] },
  { id: 'sql-parameterized',       label: 'No string-concat into SQL execute',         severity: 'P1', mechanism: 'static-grep',         source: 'OWASP-A05:2025', appliesTo: ['W','A','ML'] },
  { id: 'cors-not-wildcard',       label: 'No Origin:* with credentials',              severity: 'P1', mechanism: 'static-grep',         source: 'OWASP-A02:2025', appliesTo: ['W','A'] },
  { id: 'a11y-axe-clean',          label: 'axe-core · 0 serious violations',           severity: 'P1', mechanism: 'test-execution',      source: 'WebAIM',         appliesTo: ['W','S'] },
  { id: 'viewport-meta',           label: '<meta viewport> present',                   severity: 'P2', mechanism: 'static-grep',         source: 'base',           appliesTo: ['W','S','M'] },
  { id: 'error-boundary',          label: 'Root-level error boundary component',       severity: 'P2', mechanism: 'static-grep',         source: 'base',           appliesTo: ['W','S'] },
  { id: 'ci-pipeline',             label: 'CI runs test + build on PR',                severity: 'P2', mechanism: 'file-exists',         source: 'OpenSSF',        appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'ci-token-perms',          label: 'workflows set permissions explicitly',      severity: 'P2', mechanism: 'static-grep',         source: 'OpenSSF',        appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'deploy-config',           label: 'Target deploy config valid',                severity: 'P1', mechanism: 'file-exists',         source: 'Vercel/Fly',     appliesTo: ['W','A','L'] },
  { id: 'package-publishable',     label: 'npm pack / python -m build succeeds',       severity: 'P1', mechanism: 'test-execution',      source: 'npm/PyPI',       appliesTo: ['L'] },
  { id: 'binary-not-committed',    label: 'No *.exe / *.dll outside dist/',            severity: 'P3', mechanism: 'static-grep',         source: 'OpenSSF',        appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'vision-verdict',          label: 'Product matches user vision',               severity: 'P1', mechanism: 'llm-judgment',        source: 'd2p-native',     appliesTo: ['W','A','C','L','S','M','D','ML'] },
];
