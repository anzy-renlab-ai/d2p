/**
 * Tests for `daemon/src/log/track-logger.ts`.
 *
 * Phase 2 of ZeroU pivot — TDD red-green per `docs/details/12-log-module-tests.md`.
 * Surface authority: `docs/details/12-log-module-public-surface.md` @ commit 5eee600.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createTrackLogger } from './track-logger.js';

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
