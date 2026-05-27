/**
 * Tests for review-server.ts (Phase 12 `zerou review --serve`).
 *
 * Boots a real http.Server bound to an ephemeral 127.0.0.1 port for each
 * test; uses global fetch (Node ≥ 18) to drive it. No mocks for the server
 * itself — only the data on disk.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  startReviewServer,
  locateUiDist,
  isInside,
  type ReviewServerHandle,
} from './review-server.js';
import { createTrackLogger } from './log-types.js';

const scratch: string[] = [];
const openHandles: ReviewServerHandle[] = [];

afterEach(async () => {
  while (openHandles.length) {
    const h = openHandles.pop();
    if (h) await h.close().catch(() => {});
  }
  while (scratch.length) {
    const d = scratch.pop();
    if (d) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

async function mkScratch(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'zerou-server-'));
  scratch.push(d);
  return d;
}

async function seedUiDist(parent: string): Promise<string> {
  const dist = path.join(parent, 'ui-dist');
  await fs.mkdir(path.join(dist, 'assets'), { recursive: true });
  await fs.writeFile(
    path.join(dist, 'index.html'),
    '<!doctype html><html><body><div id="root"></div></body></html>',
    'utf8',
  );
  await fs.writeFile(
    path.join(dist, 'assets', 'app.js'),
    'console.log("hi")',
    'utf8',
  );
  await fs.writeFile(
    path.join(dist, 'assets', 'app.css'),
    'body{color:red}',
    'utf8',
  );
  await fs.writeFile(
    path.join(dist, 'assets', 'icon.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'utf8',
  );
  return dist;
}

async function seedBundle(cwd: string, body: object): Promise<void> {
  const dir = path.join(cwd, '.zerou');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'review-bundle.json'),
    JSON.stringify(body),
    'utf8',
  );
}

async function seedRunBundle(
  cwd: string,
  ts: string,
  body: object,
): Promise<void> {
  const dir = path.join(cwd, '.zerou', 'runs', ts);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'review-bundle.json'),
    JSON.stringify(body),
    'utf8',
  );
}

async function bootServer(args: {
  cwd: string;
  uiDistDir: string;
}): Promise<ReviewServerHandle> {
  const logger = createTrackLogger('cli', { silent: true });
  const h = await startReviewServer({
    cwd: args.cwd,
    uiDistDir: args.uiDistDir,
    host: '127.0.0.1',
    port: 0,
    logger,
  });
  openHandles.push(h);
  return h;
}

describe('isInside', () => {
  it('accepts paths nested under root', () => {
    expect(isInside('/a/b', '/a/b/c')).toBe(true);
    expect(isInside('/a/b', '/a/b')).toBe(true);
  });
  it('rejects sibling and parent paths', () => {
    expect(isInside('/a/b', '/a/bc')).toBe(false);
    expect(isInside('/a/b', '/a')).toBe(false);
  });
});

describe('startReviewServer', () => {
  it('1. starts on auto-port and /api/health returns ok', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const h = await bootServer({ cwd, uiDistDir: ui });
    expect(h.port).toBeGreaterThan(0);
    expect(h.host).toBe('127.0.0.1');
    expect(h.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const r = await fetch(`${h.url}/api/health`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe('string');
  });

  it('2. /api/review-data.json returns the bundle when present', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const sample = { version: 1, generatedAt: '2026-05-27T00:00:00Z', x: 'y' };
    await seedBundle(cwd, sample);
    const h = await bootServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/api/review-data.json`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/application\/json/);
    const body = await r.json();
    expect(body).toEqual(sample);
  });

  it('3. /api/review-data.json returns 404 with helpful error when missing', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const h = await bootServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/api/review-data.json`);
    expect(r.status).toBe(404);
    const body = (await r.json()) as { error: string };
    expect(body.error).toMatch(/zerou audit/);
    expect(body.error).toMatch(/zerou enhance/);
  });

  it('4. /api/runs lists archived runs newest-first', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    await seedRunBundle(cwd, '20260527-100000', {
      version: 1,
      generatedAt: '2026-05-27T10:00:00Z',
    });
    await seedRunBundle(cwd, '20260527-120000', {
      version: 1,
      generatedAt: '2026-05-27T12:00:00Z',
    });
    const h = await bootServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/api/runs`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      runs: Array<{ ts: string; generatedAt: string | null }>;
    };
    expect(body.runs).toHaveLength(2);
    expect(body.runs[0]?.ts).toBe('20260527-120000');
    expect(body.runs[0]?.generatedAt).toBe('2026-05-27T12:00:00Z');
    expect(body.runs[1]?.ts).toBe('20260527-100000');
  });

  it('5. /api/runs/<ts>/review-data.json returns the archived bundle', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const archived = { version: 1, kind: 'archived' };
    await seedRunBundle(cwd, '20260527-090000', archived);
    const h = await bootServer({ cwd, uiDistDir: ui });
    const r = await fetch(
      `${h.url}/api/runs/20260527-090000/review-data.json`,
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(archived);
  });

  it('5b. /api/runs/<bad>/review-data.json returns 404', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const h = await bootServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/api/runs/nope/review-data.json`);
    expect(r.status).toBe(404);
  });

  it('6. path traversal in /api/runs/<ts> is blocked (charset gate)', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const h = await bootServer({ cwd, uiDistDir: ui });
    // %2F = '/' — server route regex needs single segment; %2E%2E = '..'
    const r = await fetch(`${h.url}/api/runs/..%2F..%2Fetc/review-data.json`);
    expect(r.status).toBe(404);
  });

  it('6b. path traversal in static path blocked', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    // Sibling file outside ui dir — server must not serve it.
    const outside = path.join(parent, 'secret.txt');
    await fs.writeFile(outside, 'TOPSECRET', 'utf8');
    const h = await bootServer({ cwd, uiDistDir: ui });
    // Try several traversal vectors.
    for (const p of [
      '/assets/../../secret.txt',
      '/assets/..%2F..%2Fsecret.txt',
      '/%2E%2E/secret.txt',
    ]) {
      const r = await fetch(`${h.url}${p}`);
      const text = await r.text();
      expect(text).not.toContain('TOPSECRET');
      // Either 404 or normalized away; never 200 with secret content.
      expect(r.status === 404 || r.status === 302 || !text.includes('SECRET'))
        .toBe(true);
    }
  });

  it('7. static asset /assets/app.js served with JS content-type', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const h = await bootServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/assets/app.js`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/javascript/);
    expect(await r.text()).toContain('console.log');
  });

  it('8. unknown path returns 404', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const h = await bootServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/no-such-thing.txt`);
    expect(r.status).toBe(404);
  });

  it('9. close() shuts down cleanly + subsequent requests fail', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const h = await bootServer({ cwd, uiDistDir: ui });
    const url = h.url;
    // Pop from openHandles so afterEach doesn't double-close.
    const idx = openHandles.indexOf(h);
    if (idx >= 0) openHandles.splice(idx, 1);
    await h.close();
    let failed = false;
    try {
      await fetch(`${url}/api/health`);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  it('10. binds to 127.0.0.1 only', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const h = await bootServer({ cwd, uiDistDir: ui });
    expect(h.host).toBe('127.0.0.1');
    expect(h.url.startsWith('http://127.0.0.1:')).toBe(true);
  });

  it('11. MIME types for css, json, svg are correct', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    await seedBundle(cwd, { version: 1 });
    const h = await bootServer({ cwd, uiDistDir: ui });

    const css = await fetch(`${h.url}/assets/app.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toMatch(/text\/css/);

    const svg = await fetch(`${h.url}/assets/icon.svg`);
    expect(svg.status).toBe(200);
    expect(svg.headers.get('content-type')).toMatch(/svg/);

    const json = await fetch(`${h.url}/api/review-data.json`);
    expect(json.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('12. concurrent requests are handled', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    await seedBundle(cwd, { version: 1, n: 42 });
    const h = await bootServer({ cwd, uiDistDir: ui });
    const reqs = Array.from({ length: 20 }, () =>
      fetch(`${h.url}/api/review-data.json`).then((r) => r.json()),
    );
    const results = await Promise.all(reqs);
    for (const body of results) {
      expect((body as { n: number }).n).toBe(42);
    }
  });

  it('13. GET / redirects to /?review=latest', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const h = await bootServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/?review=latest');
  });

  it('14. GET /?review=latest serves index.html', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const h = await bootServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/?review=latest`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/html/);
    const text = await r.text();
    expect(text).toContain('<div id="root">');
  });

  it('15. POST is rejected with 405', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const h = await bootServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/api/health`, { method: 'POST' });
    expect(r.status).toBe(405);
  });
});

describe('locateUiDist', () => {
  it('finds ui/dist as sibling of cli/dist (workspace layout)', async () => {
    const root = await mkScratch();
    // Layout: <root>/cli/dist/<here> + <root>/ui/dist/index.html
    const cliDist = path.join(root, 'cli', 'dist');
    const uiDist = path.join(root, 'ui', 'dist');
    await fs.mkdir(cliDist, { recursive: true });
    await fs.mkdir(uiDist, { recursive: true });
    await fs.writeFile(path.join(uiDist, 'index.html'), '<!doctype html>', 'utf8');
    const got = await locateUiDist(cliDist);
    expect(got).not.toBeNull();
    // Compare resolved paths to dodge symlink / case differences on Windows.
    expect(got && path.resolve(got)).toBe(path.resolve(uiDist));
  });

  it('returns null when ui/dist is nowhere nearby', async () => {
    const root = await mkScratch();
    const got = await locateUiDist(root);
    expect(got).toBeNull();
  });
});
