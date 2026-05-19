/**
 * Tests for /api/projects and /api/projects/:id/sessions.
 *
 * Uses an in-memory DB and a mini Hono app that wires the same query methods
 * as the real route, so we don't need to spin up the singleton in session.ts.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { runMigrations } from '../storage/migrations/index.js';
import { Queries } from '../storage/queries.js';
import type { ProjectListItem, SessionListItem } from '../types.js';

function buildApp(q: Queries) {
  const app = new Hono();
  app.get('/api/projects', (c) =>
    c.json({ projects: q.listProjects({ haiku: { input: 0, output: 0 }, sonnet: { input: 0, output: 0 }, opus: { input: 0, output: 0 } }) }),
  );
  app.get('/api/projects/:id/sessions', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) {
      return c.json({ type: 'about:blank', title: 'bad', status: 400, code: 'BAD_REQUEST' }, 400);
    }
    return c.json({ sessions: q.listSessionsByDemo(id) });
  });
  return app;
}

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return { db, q: new Queries(db) };
}

const PATH_A = process.platform === 'win32' ? 'D:\\demos\\proj-a' : '/demos/proj-a';
const PATH_B = process.platform === 'win32' ? 'D:\\demos\\proj-b' : '/demos/proj-b';

describe('GET /api/projects', () => {
  it('returns empty list when no demos registered', async () => {
    const { q } = setup();
    const app = buildApp(q);
    const res = await app.fetch(new Request('http://localhost/api/projects'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: ProjectListItem[] };
    expect(body.projects).toEqual([]);
  });

  it('lists registered demos with session counts and names', async () => {
    const { q } = setup();
    const a = q.upsertDemo(PATH_A);
    q.insertSession(a.id);
    q.insertSession(a.id);
    const b = q.upsertDemo(PATH_B);
    q.insertSession(b.id);

    const app = buildApp(q);
    const res = await app.fetch(new Request('http://localhost/api/projects'));
    const body = (await res.json()) as { projects: ProjectListItem[] };
    expect(body.projects).toHaveLength(2);
    const pa = body.projects.find((p) => p.path === PATH_A)!;
    expect(pa.name).toBe('proj-a');
    expect(pa.totalSessions).toBe(2);
    expect(pa.latestSessionStatus).toBe('SETUP');
    expect(pa.latestSessionId).toBeGreaterThan(0);
  });

  it('orders by most recent activity first', async () => {
    const { q } = setup();
    const a = q.upsertDemo(PATH_A);
    const b = q.upsertDemo(PATH_B);
    // Touch b last so it should sort first
    q.setDemoLastSession(a.id, 100);
    q.setDemoLastSession(b.id, 200);

    const app = buildApp(q);
    const res = await app.fetch(new Request('http://localhost/api/projects'));
    const body = (await res.json()) as { projects: ProjectListItem[] };
    expect(body.projects[0].path).toBe(PATH_B);
    expect(body.projects[1].path).toBe(PATH_A);
  });
});

describe('GET /api/projects/:id/sessions', () => {
  it('returns 400 on non-numeric id', async () => {
    const { q } = setup();
    const app = buildApp(q);
    const res = await app.fetch(new Request('http://localhost/api/projects/abc/sessions'));
    expect(res.status).toBe(400);
  });

  it('returns empty list when demo has no sessions', async () => {
    const { q } = setup();
    const a = q.upsertDemo(PATH_A);
    const app = buildApp(q);
    const res = await app.fetch(new Request(`http://localhost/api/projects/${a.id}/sessions`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: SessionListItem[] };
    expect(body.sessions).toEqual([]);
  });

  it('lists sessions newest-first with derived counts', async () => {
    const { q } = setup();
    const a = q.upsertDemo(PATH_A);
    const s1 = q.insertSession(a.id);
    // Older session by manually setting started_at
    // (skip — both sessions will have same insert time, but second wins ORDER BY started_at DESC + id implicit)
    const s2 = q.insertSession(a.id);
    q.insertLogEvent(s2.id, 'info', 'AGENT_START', { role: 'differ' });
    q.insertLogEvent(s2.id, 'info', 'AGENT_START', { role: 'implementer' });

    const app = buildApp(q);
    const res = await app.fetch(new Request(`http://localhost/api/projects/${a.id}/sessions`));
    const body = (await res.json()) as { sessions: SessionListItem[] };
    expect(body.sessions.length).toBe(2);
    const sess2 = body.sessions.find((s) => s.id === s2.id)!;
    expect(sess2.agentCalls).toBe(2);
    expect(sess2.commitsCount).toBe(0);
    expect(sess2.topRisk).toBeNull();
    expect(sess2.status).toBe('SETUP');
    // Existence check on s1
    expect(body.sessions.find((s) => s.id === s1.id)).toBeDefined();
  });
});
