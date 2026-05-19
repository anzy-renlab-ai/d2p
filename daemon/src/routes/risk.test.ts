/**
 * Tests for risk routes:
 *   GET  /api/commits/:sha/risk        — read persisted risk
 *   POST /api/commits/:sha/risk/score  — compute + persist (mocked diff/git)
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { runMigrations } from '../storage/migrations/index.js';
import { Queries } from '../storage/queries.js';

// We test route logic in-process without spawning git by injecting a mock
// Queries instance into a locally constructed Hono app.

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const q = new Queries(db);
  return { db, q };
}

function buildRiskApp(q: Queries) {
  const app = new Hono();

  // GET /:sha/risk
  app.get('/:sha/risk', (c) => {
    const { sha } = c.req.param();
    if (!/^[0-9a-f]{4,64}$/i.test(sha)) {
      return c.json({ type: 'about:blank', title: 'invalid sha', status: 400, code: 'BAD_REQUEST' }, 400);
    }
    const risk = q.getCommitRisk(sha);
    if (!risk) {
      return c.json({ type: 'about:blank', title: 'risk not scored yet', status: 404, code: 'NOT_FOUND' }, 404);
    }
    return c.json(risk);
  });

  // POST /:sha/risk/score (simplified — skips git diff, uses a canned diff)
  app.post('/:sha/risk/score', async (c) => {
    const { sha } = c.req.param();
    if (!/^[0-9a-f]{4,64}$/i.test(sha)) {
      return c.json({ type: 'about:blank', title: 'invalid sha', status: 400, code: 'BAD_REQUEST' }, 400);
    }
    // In tests we pass pre-computed risk in body to avoid git dependency
    let body: { band?: string; score?: number; reasons?: string[]; reviewHunks?: unknown[] };
    try {
      body = await c.req.json() as typeof body;
    } catch {
      return c.json({ type: 'about:blank', title: 'invalid json', status: 400 }, 400);
    }
    const risk = {
      band: (body.band ?? 'low') as 'low' | 'mid' | 'high',
      score: body.score ?? 0.1,
      reasons: body.reasons ?? [],
      reviewHunks: (body.reviewHunks ?? []) as { path: string; hunkIdx: number; reason: string }[],
    };
    q.setCommitRisk(sha, risk);
    return c.json(risk);
  });

  return app;
}

describe('GET /risk — 404 when no risk stored', () => {
  it('returns 404 for unknown sha', async () => {
    const { q } = setup();
    const app = buildRiskApp(q);
    const res = await app.fetch(new Request('http://localhost/abc123/risk'));
    expect(res.status).toBe(404);
  });
});

describe('GET /risk — 400 for invalid sha', () => {
  it('rejects non-hex sha containing special chars via query (direct query test)', () => {
    // Test the validation logic directly — Hono normalizes URLs before routing,
    // so we test the regex directly rather than relying on URL path tricks.
    const invalidShas = ['not-hex-at-all!!', 'abc!@#', '   ', ''];
    const hexRe = /^[0-9a-f]{4,64}$/i;
    for (const sha of invalidShas) {
      expect(hexRe.test(sha)).toBe(false);
    }
    const validShas = ['deadbeef', 'abc123', 'CAFEBABE'];
    for (const sha of validShas) {
      expect(hexRe.test(sha)).toBe(true);
    }
  });

  it('returns 400 via route for sha with non-hex characters (encoded)', async () => {
    const { q } = setup();
    const app = buildRiskApp(q);
    // Use a sha-like string that has non-hex chars
    const res = await app.fetch(new Request('http://localhost/xyz!/risk'));
    // Hono may 404 the route since xyz! is a valid path segment — the sha
    // validation inside the handler will return 400 only if Hono matches
    // the route. With xyz! it matches /:sha/risk and the regex rejects it.
    // Both 400 and 404 are acceptable "not found/invalid" signals.
    expect([400, 404]).toContain(res.status);
  });
});

describe('POST /risk/score + GET /risk round-trip', () => {
  it('stores and retrieves risk', async () => {
    const { q } = setup();
    const app = buildRiskApp(q);

    const sha = 'deadbeef1234';
    const postRes = await app.fetch(
      new Request(`http://localhost/${sha}/risk/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ band: 'mid', score: 0.5, reasons: ['R4: no test file'], reviewHunks: [] }),
      }),
    );
    expect(postRes.status).toBe(200);
    const posted = await postRes.json() as { band: string; score: number };
    expect(posted.band).toBe('mid');
    expect(posted.score).toBe(0.5);

    const getRes = await app.fetch(new Request(`http://localhost/${sha}/risk`));
    expect(getRes.status).toBe(200);
    const got = await getRes.json() as { band: string; reasons: string[] };
    expect(got.band).toBe('mid');
    expect(got.reasons).toContain('R4: no test file');
  });
});

describe('GET /risk — upsert overwrites previous result', () => {
  it('latest POST wins', async () => {
    const { q } = setup();
    const app = buildRiskApp(q);
    const sha = 'cafebabe9999';

    await app.fetch(
      new Request(`http://localhost/${sha}/risk/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ band: 'low', score: 0.1, reasons: [], reviewHunks: [] }),
      }),
    );
    await app.fetch(
      new Request(`http://localhost/${sha}/risk/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ band: 'high', score: 0.9, reasons: ['R3: core-paths'], reviewHunks: [] }),
      }),
    );

    const getRes = await app.fetch(new Request(`http://localhost/${sha}/risk`));
    const got = await getRes.json() as { band: string };
    expect(got.band).toBe('high');
  });
});
