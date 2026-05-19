/**
 * Tests for core-paths routes:
 *   GET  /api/core-paths
 *   POST /api/core-paths/check
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runMigrations } from '../storage/migrations/index.js';
import { Queries } from '../storage/queries.js';
import { loadCorePaths } from '../core-paths/loader.js';
import { checkChangedFiles } from '../core-paths/checker.js';

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const q = new Queries(db);
  return { db, q };
}

function buildApp(q: Queries) {
  const app = new Hono();

  app.get('/core-paths', (c) => {
    const session = q.getCurrentActiveSession() ?? q.getLatestSession();
    if (!session) return c.json({ globs: [], source: 'none' });
    const demo = q.getDemo(session.demoId);
    if (!demo) return c.json({ globs: [], source: 'none' });
    return c.json(loadCorePaths(demo.path));
  });

  app.post('/core-paths/check', async (c) => {
    let body: { changedPaths?: unknown };
    try { body = await c.req.json() as typeof body; } catch { return c.json({ status: 400 }, 400); }
    if (!Array.isArray(body.changedPaths)) return c.json({ status: 400 }, 400);
    const changedPaths = (body.changedPaths as unknown[]).filter((p): p is string => typeof p === 'string');
    const session = q.getCurrentActiveSession() ?? q.getLatestSession();
    if (!session) return c.json({ hits: [], matchedGlob: {} });
    const demo = q.getDemo(session.demoId);
    if (!demo) return c.json({ hits: [], matchedGlob: {} });
    const { globs } = loadCorePaths(demo.path);
    return c.json(checkChangedFiles(changedPaths, globs));
  });

  return app;
}

// Create a temp project dir with a .d2p/core-paths.yaml
function makeProjectDir(globs: string[]): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'd2p-cp-route-'));
  mkdirSync(path.join(dir, '.d2p'), { recursive: true });
  const yaml = globs.map((g) => `- ${g}`).join('\n') + '\n';
  writeFileSync(path.join(dir, '.d2p', 'core-paths.yaml'), yaml);
  return dir;
}

describe('GET /core-paths', () => {
  it('returns source=none when no session', async () => {
    const { q } = setup();
    const app = buildApp(q);
    const res = await app.fetch(new Request('http://localhost/core-paths'));
    expect(res.status).toBe(200);
    const body = await res.json() as { globs: string[]; source: string };
    expect(body.source).toBe('none');
    expect(body.globs).toEqual([]);
  });

  it('returns configured globs for session with core-paths.yaml', async () => {
    const { q } = setup();
    const projectDir = makeProjectDir(['lib/db/**', 'lib/auth/**']);
    const demo = q.upsertDemo(projectDir);
    q.insertSession(demo.id);

    const app = buildApp(q);
    const res = await app.fetch(new Request('http://localhost/core-paths'));
    const body = await res.json() as { globs: string[]; source: string };
    expect(body.source).toBe('user');
    expect(body.globs).toEqual(['lib/db/**', 'lib/auth/**']);

    rmSync(projectDir, { recursive: true, force: true });
  });
});

describe('POST /core-paths/check', () => {
  it('returns empty hits when no session', async () => {
    const { q } = setup();
    const app = buildApp(q);
    const res = await app.fetch(new Request('http://localhost/core-paths/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changedPaths: ['lib/db/schema.ts'] }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { hits: string[] };
    expect(body.hits).toEqual([]);
  });

  it('returns 400 when changedPaths missing', async () => {
    const { q } = setup();
    makeProjectDir([]);
    const app = buildApp(q);
    const res = await app.fetch(new Request('http://localhost/core-paths/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notTheRightKey: [] }),
    }));
    expect(res.status).toBe(400);
  });

  it('returns hits for matching changed paths', async () => {
    const { q } = setup();
    const projectDir = makeProjectDir(['lib/db/**', 'prompts/**']);
    const demo = q.upsertDemo(projectDir);
    q.insertSession(demo.id);

    const app = buildApp(q);
    const res = await app.fetch(new Request('http://localhost/core-paths/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changedPaths: ['src/feature.ts', 'lib/db/schema.ts', 'prompts/system.txt'],
      }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { hits: string[]; matchedGlob: Record<string, string> };
    expect(body.hits.sort()).toEqual(['lib/db/schema.ts', 'prompts/system.txt']);
    expect(body.matchedGlob['lib/db/schema.ts']).toBe('lib/db/**');

    rmSync(projectDir, { recursive: true, force: true });
  });
});
