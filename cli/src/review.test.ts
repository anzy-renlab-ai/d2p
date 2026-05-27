/**
 * Tests for review.ts (Phase 11 `zerou review` command).
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runReview, resolveReportPath } from './review.js';

let scratch: string[] = [];

beforeEach(() => { scratch = []; });
afterEach(async () => {
  for (const d of scratch) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

async function mkScratch(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'zerou-review-'));
  scratch.push(d);
  return d;
}

async function seedRun(cwd: string, ts: string, html = '<!doctype html><html></html>'): Promise<string> {
  const dir = path.join(cwd, '.zerou', 'runs', ts);
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, 'enhance-report.html');
  await fs.writeFile(p, html, 'utf8');
  return p;
}

async function seedStable(cwd: string, html = '<!doctype html><html></html>'): Promise<string> {
  const dir = path.join(cwd, '.zerou');
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, 'enhance-report.html');
  await fs.writeFile(p, html, 'utf8');
  return p;
}

describe('resolveReportPath', () => {
  it('locates stable .zerou/enhance-report.html', async () => {
    const cwd = await mkScratch();
    const p = await seedStable(cwd);
    const r = resolveReportPath({ cwd });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reportPath).toBe(p);
  });

  it('falls back to most recent archived run when stable missing', async () => {
    const cwd = await mkScratch();
    await seedRun(cwd, '20260527-100000');
    const newer = await seedRun(cwd, '20260527-120000');
    const r = resolveReportPath({ cwd });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.reportPath).toBe(newer);
      expect(r.runId).toBe('20260527-120000');
    }
  });

  it('--latest skips stable and picks most-recent run', async () => {
    const cwd = await mkScratch();
    await seedStable(cwd, '<!--stable-->');
    const newer = await seedRun(cwd, '20260527-130000');
    const r = resolveReportPath({ cwd, latestOnly: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reportPath).toBe(newer);
  });

  it('--run <ts> selects exact archived run', async () => {
    const cwd = await mkScratch();
    await seedRun(cwd, '20260527-100000');
    const specific = await seedRun(cwd, '20260527-120000');
    const r = resolveReportPath({ cwd, runId: '20260527-120000' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reportPath).toBe(specific);
  });

  it('missing .zerou returns ok=false with helpful message', async () => {
    const cwd = await mkScratch();
    const r = resolveReportPath({ cwd });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/\.zerou\//);
  });

  it('--run <ts> with missing archive returns ok=false', async () => {
    const cwd = await mkScratch();
    await fs.mkdir(path.join(cwd, '.zerou'), { recursive: true });
    const r = resolveReportPath({ cwd, runId: 'nonexistent' });
    expect(r.ok).toBe(false);
  });
});

describe('runReview', () => {
  it('opens stable html via injected opener and returns 0', async () => {
    const cwd = await mkScratch();
    const p = await seedStable(cwd);
    let opened = '';
    let stdout = '';
    const code = await runReview({
      argv: ['node', 'zerou', 'review', cwd],
      opener: async (f) => { opened = f; return { ok: true }; },
      writeOut: (s) => { stdout += s; },
      writeErr: () => {},
    });
    expect(code).toBe(0);
    expect(opened).toBe(p);
    expect(stdout).toContain(p);
  });

  it('--print does not invoke opener', async () => {
    const cwd = await mkScratch();
    await seedStable(cwd);
    let called = false;
    const code = await runReview({
      argv: ['node', 'zerou', 'review', cwd, '--print'],
      opener: async () => { called = true; return { ok: true }; },
      writeOut: () => {},
      writeErr: () => {},
    });
    expect(code).toBe(0);
    expect(called).toBe(false);
  });

  it('--run <ts> selects archived run', async () => {
    const cwd = await mkScratch();
    const archived = await seedRun(cwd, '20260527-090000');
    let opened = '';
    const code = await runReview({
      argv: ['node', 'zerou', 'review', cwd, '--run', '20260527-090000'],
      opener: async (f) => { opened = f; return { ok: true }; },
      writeOut: () => {},
      writeErr: () => {},
    });
    expect(code).toBe(0);
    expect(opened).toBe(archived);
  });

  it('missing report returns exit 4 with error message', async () => {
    const cwd = await mkScratch();
    let err = '';
    const code = await runReview({
      argv: ['node', 'zerou', 'review', cwd],
      opener: async () => ({ ok: true }),
      writeOut: () => {},
      writeErr: (s) => { err += s; },
    });
    expect(code).toBe(4);
    expect(err).toMatch(/enhance-report\.html|.zerou/);
  });

  it('opener failure returns exit 5 + suggests manual URL', async () => {
    const cwd = await mkScratch();
    await seedStable(cwd);
    let err = '';
    const code = await runReview({
      argv: ['node', 'zerou', 'review', cwd],
      opener: async () => ({ ok: false, error: 'no browser' }),
      writeOut: () => {},
      writeErr: (s) => { err += s; },
    });
    expect(code).toBe(5);
    expect(err).toContain('file://');
    expect(err).toContain('no browser');
  });

  it('--help prints usage and exits 0', async () => {
    let out = '';
    const code = await runReview({
      argv: ['node', 'zerou', 'review', '--help'],
      opener: async () => ({ ok: true }),
      writeOut: (s) => { out += s; },
      writeErr: () => {},
    });
    expect(code).toBe(0);
    expect(out).toMatch(/Usage/);
  });

  it('path that does not exist returns exit 2', async () => {
    let err = '';
    const code = await runReview({
      argv: ['node', 'zerou', 'review', path.join(os.tmpdir(), 'definitely-not-here-' + Date.now())],
      opener: async () => ({ ok: true }),
      writeOut: () => {},
      writeErr: (s) => { err += s; },
    });
    expect(code).toBe(2);
    expect(err).toMatch(/does not exist/);
  });
});

describe('runReview --serve', () => {
  function stubHandle(url = 'http://127.0.0.1:55555'): {
    handle: { url: string; port: number; host: string; close: () => Promise<void> };
    closed: () => boolean;
  } {
    let closed = false;
    return {
      handle: {
        url,
        port: Number(url.match(/:(\d+)$/)?.[1] ?? 0),
        host: '127.0.0.1',
        close: async () => { closed = true; },
      },
      closed: () => closed,
    };
  }

  it('--serve boots server, opens browser URL, then closes on waitForExit', async () => {
    const cwd = await mkScratch();
    const { handle, closed } = stubHandle();
    let openedUrl = '';
    let startedWith: { cwd: string; port?: number; uiDistDir: string } | null = null;
    let out = '';

    const code = await runReview({
      argv: ['node', 'zerou', 'review', cwd, '--serve'],
      opener: async (u) => { openedUrl = u; return { ok: true }; },
      writeOut: (s) => { out += s; },
      writeErr: () => {},
      resolveUiDist: async () => '/fake/ui/dist',
      startServer: async (a) => { startedWith = a; return handle; },
      waitForExit: async () => {},
    });

    expect(code).toBe(0);
    expect(startedWith).not.toBeNull();
    expect(startedWith!.cwd).toBe(cwd);
    expect(startedWith!.uiDistDir).toBe('/fake/ui/dist');
    expect(openedUrl).toBe(handle.url);
    expect(out).toContain(handle.url);
    expect(out).toContain('Ctrl-C');
    expect(closed()).toBe(true);
  });

  it('--serve --port 8080 forwards port to server', async () => {
    const cwd = await mkScratch();
    const { handle } = stubHandle('http://127.0.0.1:8080');
    let startedWith: { port?: number } | null = null;

    await runReview({
      argv: ['node', 'zerou', 'review', cwd, '--serve', '--port', '8080'],
      opener: async () => ({ ok: true }),
      writeOut: () => {},
      writeErr: () => {},
      resolveUiDist: async () => '/fake/ui/dist',
      startServer: async (a) => { startedWith = a; return handle; },
      waitForExit: async () => {},
    });

    expect(startedWith?.port).toBe(8080);
  });

  it('--serve --no-open does not invoke opener', async () => {
    const cwd = await mkScratch();
    const { handle } = stubHandle();
    let openerCalled = false;

    const code = await runReview({
      argv: ['node', 'zerou', 'review', cwd, '--serve', '--no-open'],
      opener: async () => { openerCalled = true; return { ok: true }; },
      writeOut: () => {},
      writeErr: () => {},
      resolveUiDist: async () => '/fake/ui/dist',
      startServer: async () => handle,
      waitForExit: async () => {},
    });

    expect(code).toBe(0);
    expect(openerCalled).toBe(false);
  });

  it('--serve with missing ui/dist returns exit 4', async () => {
    const cwd = await mkScratch();
    let err = '';
    const code = await runReview({
      argv: ['node', 'zerou', 'review', cwd, '--serve'],
      opener: async () => ({ ok: true }),
      writeOut: () => {},
      writeErr: (s) => { err += s; },
      resolveUiDist: async () => null,
      startServer: async () => { throw new Error('should not be called'); },
      waitForExit: async () => {},
    });
    expect(code).toBe(4);
    expect(err).toMatch(/ui\/dist/);
    expect(err).toMatch(/pnpm/);
  });

  it('--serve server failure returns exit 6', async () => {
    const cwd = await mkScratch();
    let err = '';
    const code = await runReview({
      argv: ['node', 'zerou', 'review', cwd, '--serve'],
      opener: async () => ({ ok: true }),
      writeOut: () => {},
      writeErr: (s) => { err += s; },
      resolveUiDist: async () => '/fake/ui/dist',
      startServer: async () => { throw new Error('EADDRINUSE'); },
      waitForExit: async () => {},
    });
    expect(code).toBe(6);
    expect(err).toMatch(/EADDRINUSE|could not start/);
  });
});
