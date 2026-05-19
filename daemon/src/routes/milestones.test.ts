/**
 * Tests for milestones routes:
 *   GET   /api/milestones
 *   POST  /api/milestones
 *   PATCH /api/milestones/:id
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { runMigrations } from '../storage/migrations/index.js';
import { Queries } from '../storage/queries.js';
import type { MilestoneRow, MilestoneStatus } from '../types.js';

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const q = new Queries(db);
  return { db, q };
}

function buildApp(q: Queries) {
  const app = new Hono();

  function isValidStatus(s: unknown): s is MilestoneStatus {
    return s === 'pending' || s === 'in_progress' || s === 'done';
  }

  app.get('/milestones', (c) => {
    const session = q.getCurrentActiveSession() ?? q.getLatestSession();
    if (!session) return c.json({ milestones: [] });
    return c.json({ milestones: q.listMilestones(session.id) });
  });

  app.post('/milestones', async (c) => {
    const session = q.getCurrentActiveSession() ?? q.getLatestSession();
    if (!session) return c.json({ type: 'about:blank', status: 404, code: 'NOT_FOUND' }, 404);
    let body: { title?: unknown; visionExcerpt?: unknown; presetItemIds?: unknown; status?: unknown; ordinal?: unknown };
    try { body = await c.req.json() as typeof body; } catch { return c.json({ status: 400 }, 400); }
    if (!body.title || typeof body.title !== 'string') return c.json({ status: 400, code: 'BAD_REQUEST' }, 400);
    const milestone = q.upsertMilestone({
      sessionId: session.id,
      title: body.title,
      visionExcerpt: typeof body.visionExcerpt === 'string' ? body.visionExcerpt : null,
      presetItemIds: Array.isArray(body.presetItemIds) ? body.presetItemIds as string[] : [],
      status: isValidStatus(body.status) ? body.status : 'pending',
      ordinal: typeof body.ordinal === 'number' ? body.ordinal : 0,
    });
    return c.json(milestone, 201);
  });

  app.patch('/milestones/:id', async (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json({ status: 400 }, 400);
    let body: { status?: unknown; completedAt?: unknown };
    try { body = await c.req.json() as typeof body; } catch { return c.json({ status: 400 }, 400); }
    const existing = q.getMilestone(id);
    if (!existing) return c.json({ status: 404 }, 404);
    const updated = q.upsertMilestone({
      id,
      sessionId: existing.sessionId,
      title: existing.title,
      status: isValidStatus(body.status) ? body.status : existing.status,
      completedAt: body.completedAt !== undefined
        ? typeof body.completedAt === 'number' ? body.completedAt : null
        : existing.completedAt,
    });
    return c.json(updated);
  });

  return app;
}

function makeSession(q: Queries) {
  const demoPath = process.platform === 'win32' ? 'D:\\demo-m' : '/demo-m';
  const demo = q.upsertDemo(demoPath);
  return q.insertSession(demo.id);
}

describe('GET /milestones', () => {
  it('returns empty list when no session', async () => {
    const { q } = setup();
    const app = buildApp(q);
    const res = await app.fetch(new Request('http://localhost/milestones'));
    expect(res.status).toBe(200);
    const body = await res.json() as { milestones: unknown[] };
    expect(body.milestones).toEqual([]);
  });

  it('returns empty list when session has no milestones', async () => {
    const { q } = setup();
    makeSession(q);
    const app = buildApp(q);
    const res = await app.fetch(new Request('http://localhost/milestones'));
    const body = await res.json() as { milestones: unknown[] };
    expect(body.milestones).toHaveLength(0);
  });
});

describe('POST /milestones', () => {
  it('creates a milestone', async () => {
    const { q } = setup();
    makeSession(q);
    const app = buildApp(q);

    const res = await app.fetch(new Request('http://localhost/milestones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Lobby', visionExcerpt: 'Game lobby', ordinal: 1 }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json() as MilestoneRow;
    expect(body.title).toBe('Lobby');
    expect(body.status).toBe('pending');
    expect(body.ordinal).toBe(1);
  });

  it('returns 400 when title missing', async () => {
    const { q } = setup();
    makeSession(q);
    const app = buildApp(q);
    const res = await app.fetch(new Request('http://localhost/milestones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visionExcerpt: 'no title' }),
    }));
    expect(res.status).toBe(400);
  });
});

describe('PATCH /milestones/:id', () => {
  it('updates milestone status', async () => {
    const { q } = setup();
    makeSession(q);
    const app = buildApp(q);

    // create first
    const postRes = await app.fetch(new Request('http://localhost/milestones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Watch', ordinal: 2 }),
    }));
    const created = await postRes.json() as MilestoneRow;

    // patch status
    const patchRes = await app.fetch(new Request(`http://localhost/milestones/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done', completedAt: 1234567890 }),
    }));
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json() as MilestoneRow;
    expect(updated.status).toBe('done');
    expect(updated.completedAt).toBe(1234567890);
  });

  it('returns 404 for unknown id', async () => {
    const { q } = setup();
    makeSession(q);
    const app = buildApp(q);
    const res = await app.fetch(new Request('http://localhost/milestones/9999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    }));
    expect(res.status).toBe(404);
  });

  it('list reflects created milestones in ordinal order', async () => {
    const { q } = setup();
    makeSession(q);
    const app = buildApp(q);

    await app.fetch(new Request('http://localhost/milestones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'B', ordinal: 2 }),
    }));
    await app.fetch(new Request('http://localhost/milestones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'A', ordinal: 1 }),
    }));

    const listRes = await app.fetch(new Request('http://localhost/milestones'));
    const body = await listRes.json() as { milestones: MilestoneRow[] };
    expect(body.milestones.map((m) => m.title)).toEqual(['A', 'B']);
  });
});
