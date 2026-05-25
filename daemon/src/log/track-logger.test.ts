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

describe('B-1-1 — construction & write path (tracer bullet)', () => {
  it('writes one JSONL line containing event + payload after .log + flush', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-tracer-'));

    const logger = createTrackLogger('foo', { logRoot: tmp });
    logger.log('info', 'x', { a: 1 });
    await logger.flush();

    const fooDir = path.join(tmp, 'foo');
    const dateDirs = await readdir(fooDir);
    expect(dateDirs).toHaveLength(1);
    expect(dateDirs[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const file = path.join(fooDir, dateDirs[0]!, `${logger.trace}.jsonl`);
    const content = await readFile(file, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]!);
    expect(entry.level).toBe('info');
    expect(entry.track).toBe('foo');
    expect(entry.event).toBe('x');
    expect(entry.a).toBe(1);
    expect(typeof entry.trace).toBe('string');
    expect(entry.trace).toHaveLength(26);
    expect(typeof entry.ts).toBe('number');
  });
});
