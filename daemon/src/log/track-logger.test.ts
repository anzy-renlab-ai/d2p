/**
 * Tests for `daemon/src/log/track-logger.ts`.
 *
 * Phase 2 of ZeroU pivot — TDD red-green per `docs/details/12-log-module-tests.md`.
 * Surface authority: `docs/details/12-log-module-public-surface.md` @ commit 5eee600.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, readFile, readdir, stat } from 'node:fs/promises';
import * as fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createTrackLogger, LogError, __setRotationRmForTests } from './track-logger.js';

let tmp = '';

afterEach(async () => {
  if (tmp) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    tmp = '';
  }
});

// ── B-1-1 (tracer bullet) ────────────────────────────────────────────────────
//
// "After createTrackLogger('foo', { logRoot: tmp }), calling .log('info', 'x', {})
//  causes the file <tmp>/foo/<today>/<trace>.jsonl to exist with one JSON line."
//                                  — surface §"Behavior contract" B-1-1
//
// This is the Phase-2 tracer bullet: exercises the full write path end-to-end
// (createTrackLogger → ULID gen → date format → WriteStream → JSON serialization →
//  flush → fsync). One test, one slice. Date dir is discovered via readdir so the
// test is tz-agnostic (surface promises local-time YYYY-MM-DD; UTC date in the
// test would skew at midnight crossings).

// ── helpers shared by all tests ──────────────────────────────────────────────

async function readOnlyEntry(logger: { trace: string }, opts: { logRoot: string; track: string }) {
  const trackDir = path.join(opts.logRoot, opts.track);
  const dateDirs = await readdir(trackDir);
  expect(dateDirs).toHaveLength(1);
  expect(dateDirs[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const file = path.join(trackDir, dateDirs[0]!, `${logger.trace}.jsonl`);
  const content = await readFile(file, 'utf8');
  return content.trim().split('\n').map((l) => JSON.parse(l));
}

const CROCKFORD_ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

// ── B-1-1 (tracer bullet) ────────────────────────────────────────────────────

describe('B-1-1 — construction & write path (tracer bullet)', () => {
  it('writes one JSONL line containing event + payload after .log + flush', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-tracer-'));

    const logger = createTrackLogger('foo', { logRoot: tmp });
    logger.log('info', 'x', { a: 1 });
    await logger.flush();

    const [entry] = await readOnlyEntry(logger, { logRoot: tmp, track: 'foo' });
    expect(entry.level).toBe('info');
    expect(entry.track).toBe('foo');
    expect(entry.event).toBe('x');
    expect(entry.a).toBe(1);
    expect(typeof entry.trace).toBe('string');
    expect(entry.trace).toHaveLength(26);
    expect(typeof entry.ts).toBe('number');
  });
});

// ── B-1-2 — entry shape & root-logger scope absence ─────────────────────────

describe('B-1-2 — entry shape', () => {
  it('T-1-2-1: entry has ts:int, level, track, trace (Crockford ULID), event, plus caller keys', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b12-'));
    const logger = createTrackLogger('hardener', { logRoot: tmp });
    const before = Date.now();
    logger.log('info', 'audit.start', { repo: '/tmp/r', cwd: process.cwd() });
    await logger.flush();
    const after = Date.now();

    const [entry] = await readOnlyEntry(logger, { logRoot: tmp, track: 'hardener' });
    expect(Number.isInteger(entry.ts)).toBe(true);
    expect(entry.ts).toBeGreaterThanOrEqual(before);
    expect(entry.ts).toBeLessThanOrEqual(after);
    expect(entry.level).toBe('info');
    expect(entry.track).toBe('hardener');
    expect(typeof entry.trace).toBe('string');
    expect(entry.trace).toMatch(CROCKFORD_ULID_RE);
    expect(entry.event).toBe('audit.start');
    expect(entry.repo).toBe('/tmp/r');
    expect(entry.cwd).toBe(process.cwd());
  });

  it('T-1-2-2: entry from root logger does NOT carry a scope field', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b12b-'));
    const logger = createTrackLogger('hardener', { logRoot: tmp });
    logger.log('info', 'x', {});
    await logger.flush();
    const [entry] = await readOnlyEntry(logger, { logRoot: tmp, track: 'hardener' });
    expect('scope' in entry).toBe(false);
  });
});

// ── B-1-3 — child(scope) writes scope:'s' ────────────────────────────────────

describe('B-1-3 — child(scope) writes scope field', () => {
  it('T-1-3-1: root.child("scan").log writes entries with scope:"scan"; child shares track & trace', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b13-'));
    const root = createTrackLogger('hardener', { logRoot: tmp });
    const c = root.child('scan');
    expect(c.track).toBe('hardener');
    expect(c.trace).toBe(root.trace);

    c.log('info', 'started', { n: 3 });
    await c.flush();
    const [entry] = await readOnlyEntry(root, { logRoot: tmp, track: 'hardener' });
    expect(entry.scope).toBe('scan');
    expect(entry.event).toBe('started');
    expect(entry.n).toBe(3);
  });

  it('T-1-3-2 (lead-resolved): child("") throws LogError code=LOG-E-3', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b13b-'));
    const root = createTrackLogger('hardener', { logRoot: tmp });
    expect(() => root.child('')).toThrow(LogError);
    try {
      root.child('');
    } catch (e) {
      expect((e as LogError).code).toBe('LOG-E-3');
      expect((e as Error).message).toMatch(/^LOG-E-3/);
    }
  });
});

// ── B-1-4 — nested child(scope) dot-joins ────────────────────────────────────

describe('B-1-4 — nested child joins scopes with "."', () => {
  it('T-1-4-1: root.child("a").child("b") writes scope:"a.b"', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b14-'));
    const root = createTrackLogger('preset', { logRoot: tmp });
    const ab = root.child('a').child('b');
    expect(ab.track).toBe('preset');
    expect(ab.trace).toBe(root.trace);
    ab.log('info', 'step', {});
    await ab.flush();
    const [entry] = await readOnlyEntry(root, { logRoot: tmp, track: 'preset' });
    expect(entry.scope).toBe('a.b');
  });

  it('T-1-4-2: three-level nesting joins all with "."', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b14b-'));
    const root = createTrackLogger('preset', { logRoot: tmp });
    const deep = root.child('a').child('b').child('c');
    deep.log('info', 'x', {});
    await deep.flush();
    const [entry] = await readOnlyEntry(root, { logRoot: tmp, track: 'preset' });
    expect(entry.scope).toBe('a.b.c');
  });
});

// ── B-2 — rotation ───────────────────────────────────────────────────────────
//
// Helper: seed a `<logRoot>/<track>/<YYYY-MM-DD>/` directory dated `daysAgo`
// days before today (local-time, matching the rotation cutoff).
async function seedDateDir(logRoot: string, track: string, daysAgo: number): Promise<string> {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const iso = `${y}-${m}-${day}`;
  const dir = path.join(logRoot, track, iso);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe('B-2-1 — rotation removes strictly >7-day-old date dirs', () => {
  it('T-2-1-1: dirs older than 7 days are removed; ≤7 days kept', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b21-'));
    const oldDir = await seedDateDir(tmp, 'foo', 8);     // >7 → removed
    const newDir = await seedDateDir(tmp, 'foo', 3);     // ≤7 → kept
    const boundaryKept = await seedDateDir(tmp, 'foo', 7); // exactly 7 → kept (inclusive)

    createTrackLogger('foo', { logRoot: tmp });

    await expect(stat(oldDir)).rejects.toThrow();
    await expect(stat(newDir)).resolves.toBeTruthy();
    await expect(stat(boundaryKept)).resolves.toBeTruthy();
  });

  it('T-2-1-2: rotation no-op when track dir does not exist', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b21b-'));
    expect(() => createTrackLogger('foo', { logRoot: tmp })).not.toThrow();
  });
});

// ── B-3 — level filtering & silent mode ──────────────────────────────────────

describe('B-3-1 — level filtering', () => {
  it('T-3-1-1: minLevel:"warn" drops info entries; warn entries are written', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b31-'));
    const logger = createTrackLogger('foo', { logRoot: tmp, minLevel: 'warn' });
    logger.log('info', 'x', {});
    logger.log('warn', 'y', {});
    await logger.flush();
    const entries = await readOnlyEntry(logger, { logRoot: tmp, track: 'foo' });
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('warn');
    expect(entries[0].event).toBe('y');
  });

  it('T-3-1-2: minLevel opts overrides ZEROU_LOG_LEVEL env', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b31b-'));
    vi.stubEnv('ZEROU_LOG_LEVEL', 'warn');
    const logger = createTrackLogger('foo', { logRoot: tmp, minLevel: 'debug' });
    logger.log('debug', 'd', {});
    await logger.flush();
    const entries = await readOnlyEntry(logger, { logRoot: tmp, track: 'foo' });
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('debug');
    vi.unstubAllEnvs();
  });
});

describe('B-3-2 — silent mode skips disk + rotation', () => {
  it('T-3-2-1: silent:true creates no file and skips rotation', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b32-'));
    // Seed old dir; rotation should NOT remove it under silent.
    const oldDir = await seedDateDir(tmp, 'foo', 10);
    const logger = createTrackLogger('foo', { logRoot: tmp, silent: true });
    logger.log('info', 'x', { k: 1 });
    await logger.flush();
    // No file created under foo's date dir.
    const entries = await readdir(path.join(tmp, 'foo'));
    // Only the seeded old dir should exist; no new date dirs from log()
    expect(entries.filter((n) => n !== path.basename(oldDir))).toHaveLength(0);
    await expect(stat(oldDir)).resolves.toBeTruthy(); // not rotated
  });

  it('T-3-2-2: ZEROU_LOG_NULL=1 globally disables file writes', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b32b-'));
    vi.stubEnv('ZEROU_LOG_NULL', '1');
    const logger = createTrackLogger('foo', { logRoot: tmp });
    logger.log('info', 'x', {});
    await logger.flush();
    // Track dir should not exist (no writes at all).
    await expect(stat(path.join(tmp, 'foo'))).rejects.toThrow();
    vi.unstubAllEnvs();
  });
});

describe('B-2-2 — rotation failure on one dir does not stop sibling removal', () => {
  it('T-2-2-1: one rm failure logged; rotation continues with remaining', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b22-'));
    const failDir = await seedDateDir(tmp, 'foo', 10);
    const okDir = await seedDateDir(tmp, 'foo', 11);

    // Inject rotation rm: throw on failDir, delegate to real fs.rmSync elsewhere.
    __setRotationRmForTests((abs) => {
      if (abs === failDir) throw new Error('synthetic-rm-failure');
      fsSync.rmSync(abs, { recursive: true, force: true });
    });

    try {
      expect(() => createTrackLogger('foo', { logRoot: tmp })).not.toThrow();
      // failDir still present (rm threw); okDir removed.
      await expect(stat(failDir)).resolves.toBeTruthy();
      await expect(stat(okDir)).rejects.toThrow();
    } finally {
      __setRotationRmForTests(null);
    }
  });
});
