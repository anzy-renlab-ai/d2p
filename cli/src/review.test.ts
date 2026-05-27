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
