/**
 * Tests for review-server.ts (Phase 12 `zerou review --serve`).
 *
 * Boots a real http.Server bound to an ephemeral 127.0.0.1 port for each
 * test; uses global fetch (Node ≥ 18) to drive it. No mocks for the server
 * itself — only the data on disk.
 */
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { describe, it, expect, afterEach } from 'vitest';

import {
  startReviewServer,
  locateUiDist,
  isInside,
  realInside,
  readStableBundle,
  readArchivedBundle,
  type ReviewServerHandle,
} from './review-server.js';
import { createTrackLogger } from './log-types.js';

/**
 * Write a file just over the 50 MB cap so the size-gate fires on real disk
 * metadata. Uses a sparse-ish single big write of zero bytes — fast (~tens of
 * ms) and proves the stat-based cap without mocking the subject under test.
 */
async function writeOversized(filePath: string): Promise<void> {
  const oversize = 50 * 1024 * 1024 + 1024; // 50 MB + 1 KB
  const fh = await fs.open(filePath, 'w');
  try {
    // Grow the file to the target size without buffering 50 MB in JS heap.
    await fh.truncate(oversize);
  } finally {
    await fh.close();
  }
}

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
  it('rejects `..` traversal that escapes root', () => {
    expect(isInside('/a/b', '/a/b/../../etc/passwd')).toBe(false);
    expect(isInside('/a/b', '/a/b/c/../../..')).toBe(false);
  });
  it('on win32 the relative test is case-insensitive-aware', () => {
    // path.relative on win32 treats drive/letters case-insensitively, so a
    // legit lowercase request under an uppercase root still resolves inside.
    if (process.platform === 'win32') {
      expect(isInside('C:\\Foo\\Bar', 'c:\\foo\\bar\\baz.js')).toBe(true);
      expect(isInside('C:\\Foo\\Bar', 'C:\\Foo\\Other')).toBe(false);
    } else {
      // POSIX is case-sensitive — just assert the happy path still works.
      expect(isInside('/foo/bar', '/foo/bar/baz.js')).toBe(true);
    }
  });
});

describe('realInside (symlink-aware containment)', () => {
  const scratchDirs: string[] = [];
  afterEach(async () => {
    while (scratchDirs.length) {
      const d = scratchDirs.pop();
      if (d) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('returns realpath for a legit file inside root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zerou-real-'));
    scratchDirs.push(root);
    const inside = path.join(root, 'asset.js');
    await fs.writeFile(inside, 'x', 'utf8');
    const got = realInside(root, inside);
    expect(got).not.toBeNull();
    expect(path.resolve(got!)).toBe(fsSync.realpathSync(inside));
  });

  it('rejects a symlink inside root that escapes to an outside file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zerou-real-'));
    scratchDirs.push(root);
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zerou-out-'));
    scratchDirs.push(outsideDir);
    const secret = path.join(outsideDir, 'id_rsa');
    await fs.writeFile(secret, 'PRIVATE_KEY', 'utf8');
    const link = path.join(root, 'evil');
    let symlinkOk = true;
    try {
      // 'file' junction type for win32 file symlinks (needs dev mode / admin;
      // if it fails we skip — the lexical guard still applies in that case).
      await fs.symlink(secret, link, 'file');
    } catch {
      symlinkOk = false;
    }
    if (!symlinkOk) return; // environment can't create symlinks; skip cleanly
    const got = realInside(root, link);
    expect(got).toBeNull();
  });

  it('resolves a not-yet-existing file via its parent dir', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zerou-real-'));
    scratchDirs.push(root);
    const future = path.join(root, 'does-not-exist-yet.js');
    const got = realInside(root, future);
    expect(got).not.toBeNull();
  });

  it('rejects when the path escapes via `..`', () => {
    expect(realInside('/no/such/root', '/no/such/root/../../etc')).toBeNull();
  });
});

describe('bundle size cap (DoS guard)', () => {
  it('readStableBundle returns too-large for a >50MB bundle (gate before readFile)', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'zerou-cap-'));
    scratch.push(cwd);
    const dir = path.join(cwd, '.zerou');
    await fs.mkdir(dir, { recursive: true });
    await writeOversized(path.join(dir, 'review-bundle.json'));
    const result = await readStableBundle(cwd);
    expect(result.kind).toBe('too-large');
    if (result.kind === 'too-large') {
      expect(result.size).toBeGreaterThan(50 * 1024 * 1024);
    }
  });

  it('readArchivedBundle returns too-large for a >50MB archived bundle', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'zerou-cap-'));
    scratch.push(cwd);
    const ts = '20260527-100000';
    const dir = path.join(cwd, '.zerou', 'runs', ts);
    await fs.mkdir(dir, { recursive: true });
    await writeOversized(path.join(dir, 'review-bundle.json'));
    const result = await readArchivedBundle(cwd, ts);
    expect(result.kind).toBe('too-large');
  });

  it('readStableBundle returns ok for a normal-size bundle', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'zerou-cap-'));
    scratch.push(cwd);
    const dir = path.join(cwd, '.zerou');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'review-bundle.json'),
      JSON.stringify({ version: 1 }),
      'utf8',
    );
    const result = await readStableBundle(cwd);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(JSON.parse(result.data)).toEqual({ version: 1 });
    }
  });

  it('readArchivedBundle rejects bad ts charset as missing', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'zerou-cap-'));
    scratch.push(cwd);
    const result = await readArchivedBundle(cwd, '../../etc');
    expect(result.kind).toBe('missing');
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

  it('2c. /api/review-data.json returns 413 (not OOM) when bundle exceeds 50MB cap', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    // Write a genuinely oversized bundle (51 MB > 50 MB cap) so the stat-gate
    // fires on real disk metadata — no mock of the subject under test.
    const dir = path.join(cwd, '.zerou');
    await fs.mkdir(dir, { recursive: true });
    const bundlePath = path.join(dir, 'review-bundle.json');
    await writeOversized(bundlePath);
    const h = await bootServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/api/review-data.json`);
    expect(r.status).toBe(413);
    const body = (await r.json()) as { error: string };
    expect(body.error).toMatch(/too large/);
  });

  it('2d. /api/runs/<ts>/review-data.json returns 413 when archived bundle exceeds cap', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const ts = '20260527-090000';
    const dir = path.join(cwd, '.zerou', 'runs', ts);
    await fs.mkdir(dir, { recursive: true });
    const bundlePath = path.join(dir, 'review-bundle.json');
    await writeOversized(bundlePath);
    const h = await bootServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/api/runs/${ts}/review-data.json`);
    expect(r.status).toBe(413);
    const body = (await r.json()) as { error: string };
    expect(body.error).toMatch(/too large/);
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

// ── Live-streaming endpoints (Phase 14 Worker A) ───────────────────────────

async function bootStreamingServer(args: {
  cwd: string;
  uiDistDir: string;
  heartbeatMs?: number;
  watchDebounceMs?: number;
  maxSseConnections?: number;
}): Promise<ReviewServerHandle> {
  const logger = createTrackLogger('cli', { silent: true });
  const h = await startReviewServer({
    cwd: args.cwd,
    uiDistDir: args.uiDistDir,
    host: '127.0.0.1',
    port: 0,
    logger,
    heartbeatMs: args.heartbeatMs ?? 150,
    watchDebounceMs: args.watchDebounceMs ?? 25,
    maxSseConnections: args.maxSseConnections,
  });
  openHandles.push(h);
  return h;
}

/**
 * Open an SSE connection and incrementally collect parsed event blocks until
 * `predicate` returns true OR `timeoutMs` elapses. Yields the AbortController
 * via the optional `onController` callback so the caller can disconnect.
 */
async function collectSse(
  url: string,
  predicate: (events: ParsedSseEvent[]) => boolean,
  opts: {
    timeoutMs?: number;
    headers?: Record<string, string>;
    onController?: (ctrl: AbortController) => void;
    /** Optional async hook fired AFTER connect (replay sent) but before main read. */
    afterConnect?: () => Promise<void> | void;
  } = {},
): Promise<ParsedSseEvent[]> {
  const ctrl = new AbortController();
  opts.onController?.(ctrl);
  const res = await fetch(url, {
    headers: opts.headers ?? {},
    signal: ctrl.signal,
  });
  if (res.status !== 200) {
    ctrl.abort();
    throw new Error(`SSE bad status ${res.status}`);
  }
  if (!res.body) {
    ctrl.abort();
    throw new Error('SSE no body');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events: ParsedSseEvent[] = [];
  let buf = '';
  const timeout = opts.timeoutMs ?? 4000;

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      ctrl.abort();
    } catch {
      /* noop */
    }
  }, timeout);

  // Side-channel hook so callers can mutate filesystem AFTER server has
  // attached the watcher (which happens on first SSE connect).
  if (opts.afterConnect) {
    // Read first chunk (containing initial heartbeat / replay) so the
    // watcher is guaranteed to be attached before the hook fires.
    try {
      const first = await reader.read();
      if (first.value) {
        buf += decoder.decode(first.value, { stream: true });
        let idx = buf.indexOf('\n\n');
        while (idx >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const parsed = parseSseBlock(block);
          if (parsed) events.push(parsed);
          idx = buf.indexOf('\n\n');
        }
      }
    } catch {
      /* aborted — fall through */
    }
    await opts.afterConnect();
  }

  while (!timedOut) {
    if (predicate(events)) break;
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      break; // aborted
    }
    if (chunk.done) break;
    if (chunk.value) {
      buf += decoder.decode(chunk.value, { stream: true });
      let idx = buf.indexOf('\n\n');
      while (idx >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const parsed = parseSseBlock(block);
        if (parsed) events.push(parsed);
        idx = buf.indexOf('\n\n');
      }
    }
  }
  clearTimeout(timer);
  try {
    ctrl.abort();
  } catch {
    /* noop */
  }
  try {
    await reader.cancel();
  } catch {
    /* noop */
  }
  return events;
}

interface ParsedSseEvent {
  id?: string;
  event?: string;
  data?: string;
}

function parseSseBlock(block: string): ParsedSseEvent | null {
  const out: ParsedSseEvent = {};
  for (const line of block.split('\n')) {
    if (line.startsWith('id:')) out.id = line.slice(3).trim();
    else if (line.startsWith('event:')) out.event = line.slice(6).trim();
    else if (line.startsWith('data:')) out.data = line.slice(5).trim();
  }
  if (!out.event && !out.data) return null;
  return out;
}

async function appendLine(file: string, line: string): Promise<void> {
  await fs.appendFile(file, `${line}\n`, 'utf8');
}

describe('SSE /api/stream', () => {
  it('S1. sends initial heartbeat immediately on connect', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    await fs.mkdir(path.join(cwd, '.zerou'), { recursive: true });
    const h = await bootStreamingServer({ cwd, uiDistDir: ui });
    const events = await collectSse(
      `${h.url}/api/stream`,
      (evs) => evs.some((e) => e.event === 'heartbeat'),
      { timeoutMs: 2000 },
    );
    const hb = events.find((e) => e.event === 'heartbeat');
    expect(hb).toBeDefined();
    expect(hb?.id).toBeDefined();
    const data = JSON.parse(hb!.data!) as { ts: string };
    expect(typeof data.ts).toBe('string');
  });

  it('S2. emits branch-trace.append when branch-trace.jsonl grows', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const zerouDir = path.join(cwd, '.zerou');
    await fs.mkdir(zerouDir, { recursive: true });
    const tracePath = path.join(zerouDir, 'branch-trace.jsonl');
    await fs.writeFile(tracePath, '', 'utf8');
    const h = await bootStreamingServer({ cwd, uiDistDir: ui });
    // Open the SSE connection FIRST so watchers attach + seed offsets.
    const events = await collectSse(
      `${h.url}/api/stream`,
      (evs) => evs.some((e) => e.event === 'branch-trace.append'),
      {
        timeoutMs: 4000,
        afterConnect: async () => {
          // Hub has attached watchers + seeded byte offsets by the time we
          // got the initial heartbeat — safe to mutate now.
          await new Promise((r) => setTimeout(r, 50));
          await appendLine(
            tracePath,
            JSON.stringify({ event: 'branch.evidence', branch_id: 'f.ts:foo@1:entry-line1-entry#0', verdict: 'covered', seq: 1 }),
          );
        },
      },
    );
    const bt = events.find((e) => e.event === 'branch-trace.append');
    expect(bt).toBeDefined();
    const parsed = JSON.parse(bt!.data!) as { branch_id: string; verdict: string };
    expect(parsed.branch_id).toBe('f.ts:foo@1:entry-line1-entry#0');
    expect(parsed.verdict).toBe('covered');
  });

  it('S3. emits log.append when a log file is written', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const logDir = path.join(cwd, '.zerou', 'logs', 'agent', '2026-05-27');
    await fs.mkdir(logDir, { recursive: true });
    const logFile = path.join(logDir, '01TEST.jsonl');
    await fs.writeFile(logFile, '', 'utf8');
    const h = await bootStreamingServer({ cwd, uiDistDir: ui });
    const events = await collectSse(
      `${h.url}/api/stream`,
      (evs) => evs.some((e) => e.event === 'log.append'),
      {
        timeoutMs: 4000,
        afterConnect: async () => {
          await new Promise((r) => setTimeout(r, 50));
          await appendLine(
            logFile,
            JSON.stringify({ ts: 1779877629001, level: 'info', track: 'agent', trace: '01TEST', event: 'agent.test-gen.start' }),
          );
        },
      },
    );
    const log = events.find((e) => e.event === 'log.append');
    expect(log).toBeDefined();
    const parsed = JSON.parse(log!.data!) as { event: string; track: string };
    expect(parsed.event).toBe('agent.test-gen.start');
    expect(parsed.track).toBe('agent');
  });

  it('S4. Last-Event-ID replays missed events from the ring buffer', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const zerouDir = path.join(cwd, '.zerou');
    await fs.mkdir(zerouDir, { recursive: true });
    const tracePath = path.join(zerouDir, 'branch-trace.jsonl');
    await fs.writeFile(tracePath, '', 'utf8');
    const h = await bootStreamingServer({ cwd, uiDistDir: ui });

    // Open a persistent connection so the hub keeps its ring buffer alive
    // and watchers stay attached across the test.
    const keepAliveCtrl = new AbortController();
    const keepAliveRes = await fetch(`${h.url}/api/stream`, {
      signal: keepAliveCtrl.signal,
    });
    expect(keepAliveRes.status).toBe(200);
    const keepAliveReader = keepAliveRes.body!.getReader();
    // Drain the initial heartbeat so we know the hub started.
    await keepAliveReader.read();

    // Now append two lines in sequence (debounced flush picks them up).
    await appendLine(tracePath, JSON.stringify({ branch_id: 'a', seq: 1 }));
    await new Promise((r) => setTimeout(r, 80));
    await appendLine(tracePath, JSON.stringify({ branch_id: 'b', seq: 2 }));

    // Drain the keep-alive reader for ~300ms so its socket buffer doesn't
    // accumulate (and so the appends actually flow through the hub).
    const drainUntil = Date.now() + 400;
    const decoder = new TextDecoder();
    let drainBuf = '';
    while (Date.now() < drainUntil) {
      const { value, done } = await Promise.race([
        keepAliveReader.read(),
        new Promise<{ value: undefined; done: false }>((r) =>
          setTimeout(() => r({ value: undefined, done: false }), 50),
        ),
      ]);
      if (done) break;
      if (value) drainBuf += decoder.decode(value, { stream: true });
    }
    // After draining we should have seen two branch-trace.append blocks.
    const blocks = drainBuf.split('\n\n').filter((b) => b.includes('event: branch-trace.append'));
    expect(blocks.length).toBeGreaterThanOrEqual(2);

    // Reconnect with Last-Event-ID=0 → expect both 'a' and 'b' to replay.
    const replayed = await collectSse(
      `${h.url}/api/stream`,
      (evs) =>
        evs.filter((e) => e.event === 'branch-trace.append').length >= 2,
      {
        timeoutMs: 3000,
        headers: { 'Last-Event-ID': '0' },
      },
    );
    const appends = replayed
      .filter((e) => e.event === 'branch-trace.append')
      .map((e) => JSON.parse(e.data!) as { branch_id: string });
    const ids = appends.map((a) => a.branch_id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');

    keepAliveCtrl.abort();
    try {
      await keepAliveReader.cancel();
    } catch {
      /* noop */
    }
  });

  it('S5. heartbeat repeats on the configured interval', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    await fs.mkdir(path.join(cwd, '.zerou'), { recursive: true });
    const h = await bootStreamingServer({
      cwd,
      uiDistDir: ui,
      heartbeatMs: 100,
    });
    const events = await collectSse(
      `${h.url}/api/stream`,
      (evs) => evs.filter((e) => e.event === 'heartbeat').length >= 2,
      { timeoutMs: 3000 },
    );
    const heartbeats = events.filter((e) => e.event === 'heartbeat');
    expect(heartbeats.length).toBeGreaterThanOrEqual(2);
  });

  it('S6. enforces concurrent connection limit (over-cap → 503)', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    await fs.mkdir(path.join(cwd, '.zerou'), { recursive: true });
    const h = await bootStreamingServer({
      cwd,
      uiDistDir: ui,
      maxSseConnections: 2,
    });
    const controllers: AbortController[] = [];
    // Two successful SSE connections.
    const r1 = await fetch(`${h.url}/api/stream`, {
      signal: (() => {
        const c = new AbortController();
        controllers.push(c);
        return c.signal;
      })(),
    });
    expect(r1.status).toBe(200);
    const r2 = await fetch(`${h.url}/api/stream`, {
      signal: (() => {
        const c = new AbortController();
        controllers.push(c);
        return c.signal;
      })(),
    });
    expect(r2.status).toBe(200);
    // Read a chunk to ensure the connection sticks before opening the 3rd.
    await r1.body!.getReader().read();
    await r2.body!.getReader().read();
    // 3rd MUST be rejected with 503.
    const r3 = await fetch(`${h.url}/api/stream`);
    expect(r3.status).toBe(503);
    await r3.text();
    // Cleanup.
    for (const c of controllers) c.abort();
  });

  it('S7. client disconnect drops the connection from the hub', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    await fs.mkdir(path.join(cwd, '.zerou'), { recursive: true });
    const h = await bootStreamingServer({
      cwd,
      uiDistDir: ui,
      maxSseConnections: 1,
    });
    const ctrl = new AbortController();
    const res = await fetch(`${h.url}/api/stream`, { signal: ctrl.signal });
    expect(res.status).toBe(200);
    await res.body!.getReader().read();
    ctrl.abort();
    // Give server a beat to notice the close.
    await new Promise((r) => setTimeout(r, 200));
    // Now a fresh connection should succeed (limit is 1 + we freed the slot).
    const ctrl2 = new AbortController();
    const res2 = await fetch(`${h.url}/api/stream`, { signal: ctrl2.signal });
    expect(res2.status).toBe(200);
    ctrl2.abort();
  });
});

describe('GET /api/branch-trace', () => {
  it('B1. returns the full file as ndjson', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const zerouDir = path.join(cwd, '.zerou');
    await fs.mkdir(zerouDir, { recursive: true });
    const body = [
      JSON.stringify({ branch_id: 'a', seq: 1 }),
      JSON.stringify({ branch_id: 'b', seq: 2 }),
      JSON.stringify({ branch_id: 'c', seq: 3 }),
    ].join('\n') + '\n';
    await fs.writeFile(path.join(zerouDir, 'branch-trace.jsonl'), body, 'utf8');
    const h = await bootStreamingServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/api/branch-trace`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/x-ndjson/);
    const text = await r.text();
    expect(text).toBe(body);
  });

  it('B2. ?since=<n> skips first N lines', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const zerouDir = path.join(cwd, '.zerou');
    await fs.mkdir(zerouDir, { recursive: true });
    const body = [
      JSON.stringify({ branch_id: 'a' }),
      JSON.stringify({ branch_id: 'b' }),
      JSON.stringify({ branch_id: 'c' }),
    ].join('\n') + '\n';
    await fs.writeFile(path.join(zerouDir, 'branch-trace.jsonl'), body, 'utf8');
    const h = await bootStreamingServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/api/branch-trace?since=2`);
    expect(r.status).toBe(200);
    const text = await r.text();
    const lines = text.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as { branch_id: string };
    expect(parsed.branch_id).toBe('c');
  });

  it('B3. ?run=<ts> reads archived branch-trace', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const ts = '20260527-100000';
    const archDir = path.join(cwd, '.zerou', 'runs', ts);
    await fs.mkdir(archDir, { recursive: true });
    const body = `${JSON.stringify({ branch_id: 'archived', seq: 1 })}\n`;
    await fs.writeFile(path.join(archDir, 'branch-trace.jsonl'), body, 'utf8');
    const h = await bootStreamingServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/api/branch-trace?run=${ts}`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain('archived');
  });

  it('B4. returns 404 when branch-trace.jsonl missing', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const h = await bootStreamingServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/api/branch-trace`);
    expect(r.status).toBe(404);
  });

  it('B5. rejects path-traversal run values', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const h = await bootStreamingServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/api/branch-trace?run=..%2F..%2Fetc`);
    expect(r.status).toBe(404);
  });
});

// Phase 14D — branch-manifest endpoint mirrors branch-trace but reads the
// full AST snapshot file. Same security rails, separate underlying file.
describe('GET /api/branch-manifest', () => {
  it('M1. returns the full manifest file as ndjson', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const zerouDir = path.join(cwd, '.zerou');
    await fs.mkdir(zerouDir, { recursive: true });
    const body =
      [
        JSON.stringify({ branch_id: 'a', seq: 1, verdict: 'untested' }),
        JSON.stringify({ branch_id: 'b', seq: 2, verdict: 'covered' }),
      ].join('\n') + '\n';
    await fs.writeFile(path.join(zerouDir, 'branch-manifest.jsonl'), body, 'utf8');
    const h = await bootStreamingServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/api/branch-manifest`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/x-ndjson/);
    const text = await r.text();
    expect(text).toBe(body);
  });

  it('M2. returns 404 when branch-manifest.jsonl missing', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const h = await bootStreamingServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/api/branch-manifest`);
    expect(r.status).toBe(404);
  });

  it('M3. ?run=<ts> reads archived manifest', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const ts = '20260528-100000';
    const archDir = path.join(cwd, '.zerou', 'runs', ts);
    await fs.mkdir(archDir, { recursive: true });
    const body = `${JSON.stringify({ branch_id: 'archived-manifest', seq: 1 })}\n`;
    await fs.writeFile(path.join(archDir, 'branch-manifest.jsonl'), body, 'utf8');
    const h = await bootStreamingServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/api/branch-manifest?run=${ts}`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain('archived-manifest');
  });
});

describe('GET /api/logs/tail', () => {
  async function seedLog(
    cwd: string,
    track: string,
    date: string,
    file: string,
    lines: Array<Record<string, unknown>>,
  ): Promise<void> {
    const dir = path.join(cwd, '.zerou', 'logs', track, date);
    await fs.mkdir(dir, { recursive: true });
    const body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
    await fs.writeFile(path.join(dir, file), body, 'utf8');
  }

  it('L1. returns merged tail across tracks', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    await seedLog(cwd, 'agent', '2026-05-27', '01A.jsonl', [
      { ts: 1, track: 'agent', event: 'agent.start' },
      { ts: 3, track: 'agent', event: 'agent.step' },
    ]);
    await seedLog(cwd, 'audit', '2026-05-27', '01B.jsonl', [
      { ts: 2, track: 'audit', event: 'audit.start' },
    ]);
    const h = await bootStreamingServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/api/logs/tail`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/x-ndjson/);
    const text = await r.text();
    const lines = text
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as { ts: number; event: string });
    expect(lines.map((l) => l.ts)).toEqual([1, 2, 3]);
  });

  it('L2. ?track=agent filters to one track', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    await seedLog(cwd, 'agent', '2026-05-27', '01A.jsonl', [
      { ts: 1, track: 'agent', event: 'agent.start' },
    ]);
    await seedLog(cwd, 'audit', '2026-05-27', '01B.jsonl', [
      { ts: 2, track: 'audit', event: 'audit.start' },
    ]);
    const h = await bootStreamingServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/api/logs/tail?track=agent`);
    expect(r.status).toBe(200);
    const text = await r.text();
    const lines = text
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as { track: string });
    expect(lines.every((l) => l.track === 'agent')).toBe(true);
    expect(lines).toHaveLength(1);
  });

  it('L3. ?limit=<n> caps the output', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const lines = Array.from({ length: 10 }, (_, i) => ({
      ts: i,
      track: 'agent',
      event: `e${i}`,
    }));
    await seedLog(cwd, 'agent', '2026-05-27', '01A.jsonl', lines);
    const h = await bootStreamingServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/api/logs/tail?limit=3`);
    expect(r.status).toBe(200);
    const text = await r.text();
    const got = text.split('\n').filter((l) => l.length > 0);
    expect(got).toHaveLength(3);
    const parsed = got.map((l) => JSON.parse(l) as { event: string });
    expect(parsed.map((p) => p.event)).toEqual(['e7', 'e8', 'e9']);
  });

  it('L4. handles missing logs dir gracefully', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const h = await bootStreamingServer({ cwd, uiDistDir: ui });
    const r = await fetch(`${h.url}/api/logs/tail`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('');
  });

  it('L5. rejects bad track / bad limit', async () => {
    const parent = await mkScratch();
    const ui = await seedUiDist(parent);
    const cwd = await mkScratch();
    const h = await bootStreamingServer({ cwd, uiDistDir: ui });
    const bad = await fetch(`${h.url}/api/logs/tail?track=../etc`);
    expect(bad.status).toBe(400);
    const badLimit = await fetch(`${h.url}/api/logs/tail?limit=-1`);
    expect(badLimit.status).toBe(400);
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
