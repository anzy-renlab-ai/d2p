import { Hono } from 'hono';
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { StartSessionReq, StartSessionRes, CurrentSessionRes } from '../types.js';
import { Queries } from '../storage/queries.js';
import { openDatabase } from '../storage/db.js';
import { runMigrations } from '../storage/migrations/index.js';
import { sseHub } from '../log/sse.js';
import { PRICING_PER_MTOK } from '../cost/pricing.js';
import { git } from '../subproc/git.js';
import { currentCriticPolicy } from '../engines/registry.js';

/** Per v0.7 §3.1 + MVP-0.5 spec §A.6, sessions can only start when cross-engine
 *  reviewer policy is active (worker + critic in different LLM families).
 *  Smoke / test fixtures set D2P_ALLOW_DEGRADED_REVIEWER=1 to bypass — this is
 *  a test-only escape hatch, not a user-facing feature. */
function crossEngineBlockedReason(): string | null {
  if (process.env.D2P_ALLOW_DEGRADED_REVIEWER === '1') return null;
  const policy = currentCriticPolicy();
  if (!policy) return null; // engine not yet initialized — let downstream code surface
  if (policy.crossFamily) return null;
  return policy.reason; // 'no-critic-configured' | 'same-family-as-worker'
}

// Single DB instance per daemon process.
const db: Database.Database = openDatabase();
runMigrations(db);
export const queries: Queries = new Queries(db);
export const dbHandle: Database.Database = db;

export const sessionRoutes = new Hono();

sessionRoutes.post('/start', async (c) => {
  // Cross-engine reviewer policy is a hard prerequisite for session start
  // (v0.7 §3.1 + MVP-0.5 spec §A.6). Check before parsing body so onboarding
  // UI gets immediate signal without needing to construct a valid request.
  const blocker = crossEngineBlockedReason();
  if (blocker) {
    return c.json(
      {
        type: 'about:blank',
        title: 'cross-engine reviewer required',
        status: 412,
        code: 'E_CROSS_ENGINE_REQUIRED',
        detail:
          blocker === 'no-critic-configured'
            ? 'Configure a second LLM engine (criticEngine in ~/.d2p/config.json) of a different family from worker. Run `d2p doctor` for guidance.'
            : 'Worker and critic engines share the same LLM family. Choose a critic of a different family (e.g. worker=claude-cli + critic=codex-cli).',
        reason: blocker,
      },
      412,
    );
  }

  let body: StartSessionReq;
  try {
    body = (await c.req.json()) as StartSessionReq;
  } catch {
    return c.json(
      { type: 'about:blank', title: 'invalid json', status: 400, code: 'BAD_REQUEST' },
      400,
    );
  }

  const demoPath = body.demoPath;
  if (typeof demoPath !== 'string' || !path.isAbsolute(demoPath) || demoPath.includes('..')) {
    return c.json(
      {
        type: 'about:blank',
        title: 'demoPath must be an absolute path without ..',
        status: 400,
        code: 'BAD_REQUEST',
      },
      400,
    );
  }

  // Ensure dir + git repo
  mkdirSync(demoPath, { recursive: true });
  if (!existsSync(path.join(demoPath, '.git'))) {
    const initRes = await git(['init', '-q', '-b', 'main'], demoPath);
    if (initRes.exitCode !== 0) {
      return c.json(
        { type: 'about:blank', title: 'git init failed', status: 500, code: 'IO_ERROR', detail: initRes.stderr },
        500,
      );
    }
    // first commit so worktrees can branch
    await git(['add', '-A'], demoPath);
    await git(
      ['-c', 'user.email=d2p-init@local', '-c', 'user.name=d2p', 'commit', '-q', '--allow-empty', '-m', 'chore: d2p initial commit'],
      demoPath,
    );
  }

  const demo = queries.upsertDemo(demoPath);
  const existing = queries.findActiveSessionForDemo(demo.id);
  if (existing) {
    queries.setDemoLastSession(demo.id, Date.now());
    const res: StartSessionRes = { sessionId: existing.id, status: existing.status, isResume: true };
    return c.json(res);
  }

  const conflict = queries.getCurrentActiveSession();
  if (conflict && conflict.demoId !== demo.id) {
    return c.json(
      {
        type: 'about:blank',
        title: 'another active session exists',
        status: 409,
        code: 'CONFLICT',
        detail: `session ${conflict.id} on demo ${conflict.demoId} is ${conflict.status}`,
      },
      409,
    );
  }

  const session = queries.insertSession(demo.id);
  queries.setDemoLastSession(demo.id, session.startedAt);
  const event = queries.insertLogEvent(session.id, 'info', 'SESSION_STARTED', {
    demoPath,
    sessionId: session.id,
  });
  sseHub.publish({
    id: event.id,
    ts: event.ts,
    kind: 'SESSION_STARTED',
    level: 'info',
    payload: event.payload,
  });
  const res: StartSessionRes = { sessionId: session.id, status: session.status, isResume: false };
  return c.json(res);
});

sessionRoutes.get('/current', (c) => {
  // Active session if any, else most recent (terminal) so UI/smoke see final state.
  const session = queries.getCurrentActiveSession() ?? queries.getLatestSession();
  const body: CurrentSessionRes = {
    session,
    demo: null,
    presetStatus: [],
    costTotals: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
  };
  if (session) {
    body.presetStatus = queries.latestPresetStatus(session.id);
    body.costTotals = queries.costTotals(session.id, PRICING_PER_MTOK);
    // demo lookup
    interface Row {
      id: number;
      path: string;
      first_seen_at: number;
      last_session_at: number | null;
      inferred_type: string | null;
    }
    const row = db.prepare('SELECT * FROM demos WHERE id = ?').get(session.demoId) as Row | undefined;
    if (row) {
      body.demo = {
        id: row.id,
        path: row.path as unknown as never,
        firstSeenAt: row.first_seen_at,
        lastSessionAt: row.last_session_at,
        inferredType: row.inferred_type as never,
      };
    }
  }
  return c.json(body);
});

sessionRoutes.post('/end', async (c) => {
  const session = queries.getCurrentActiveSession() ?? queries.getLatestSession();
  if (!session) return c.json({ ok: true, message: 'no session' });
  if (session.status !== 'ENDED') {
    queries.transitionSession(session.id, 'ENDED');
  }
  const event = queries.insertLogEvent(session.id, 'info', 'SESSION_ENDED', { sessionId: session.id });
  sseHub.publish({
    id: event.id,
    ts: event.ts,
    kind: 'SESSION_ENDED',
    level: 'info',
    payload: event.payload,
  });
  // Best-effort: write session-summary.md
  let summaryPath: string | null = null;
  try {
    const { generateAndWriteSessionSummary } = await import('../session-summary/generate.js');
    summaryPath = await generateAndWriteSessionSummary({ queries, db }, session.id);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[d2p daemon] session-summary generation failed:', (e as Error).message);
  }
  return c.json({ sessionId: session.id, status: 'ENDED', summaryMdPath: summaryPath });
});
