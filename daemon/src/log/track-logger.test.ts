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
import {
  createTrackLogger,
  LogError,
  __setRotationRmForTests,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
} from './track-logger.js';
import { captureLogsFor } from './test-helpers.js';

let tmp = '';

afterEach(async () => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
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

// ── B-4 — captureLogsFor / observer infrastructure ──────────────────────────

describe('B-4-1 — captureLogsFor returns only matching-track entries', () => {
  it('T-4-1-1: capture for track A only sees A entries, not B', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b41-'));
    const a = createTrackLogger('A', { logRoot: tmp, silent: true });
    const b = createTrackLogger('B', { logRoot: tmp, silent: true });
    const { result, entries } = await captureLogsFor({ track: 'A' }, async () => {
      a.log('info', 'a-evt', {});
      b.log('info', 'b-evt', {});
      return 42;
    });
    expect(result).toBe(42);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.track).toBe('A');
    expect(entries[0]!.event).toBe('a-evt');
  });

  it('T-4-1-2: eventPattern further filters within track', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b41b-'));
    const a = createTrackLogger('A', { logRoot: tmp, silent: true });
    const { entries } = await captureLogsFor(
      { track: 'A', eventPattern: /^audit\./ },
      async () => {
        a.log('info', 'audit.start', {});
        a.log('info', 'noise', {});
        a.log('info', 'audit.end', {});
      },
    );
    expect(entries.map((e) => e.event)).toEqual(['audit.start', 'audit.end']);
  });
});

describe('B-4-2 — concurrent captureLogsFor isolation', () => {
  it('T-4-2-1: two concurrent captures each see only their own track', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b42-'));
    const a = createTrackLogger('A', { logRoot: tmp, silent: true });
    const b = createTrackLogger('B', { logRoot: tmp, silent: true });
    const [{ entries: ea }, { entries: eb }] = await Promise.all([
      captureLogsFor({ track: 'A' }, async () => {
        for (let i = 0; i < 5; i++) {
          a.log('info', 'ae', { i });
          await Promise.resolve();
        }
      }),
      captureLogsFor({ track: 'B' }, async () => {
        for (let i = 0; i < 5; i++) {
          b.log('info', 'be', { i });
          await Promise.resolve();
        }
      }),
    ]);
    expect(ea).toHaveLength(5);
    expect(ea.every((e) => e.track === 'A')).toBe(true);
    expect(eb).toHaveLength(5);
    expect(eb.every((e) => e.track === 'B')).toBe(true);
  });
});

describe('B-4-3 — captureLogsFor cleans up on throw', () => {
  it('T-4-3-1: capture re-throws and removes its observer; no leak into next capture', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b43-'));
    const a = createTrackLogger('A', { logRoot: tmp, silent: true });
    let caught: unknown;
    try {
      await captureLogsFor({ track: 'A' }, async () => {
        a.log('info', 'before-throw', {});
        throw new Error('boom');
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('boom');

    // Next capture for B must NOT see any A entries from previous run.
    const { entries } = await captureLogsFor({ track: 'B' }, async () => {
      a.log('info', 'after', {});
    });
    expect(entries).toHaveLength(0);
  });
});

describe('B-4-4 — nested captureLogsFor non-consuming', () => {
  it('T-4-4-1: nested captures on same track both see matching entries', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b44-'));
    const a = createTrackLogger('A', { logRoot: tmp, silent: true });
    const { result: innerEntries, entries: outerEntries } = await captureLogsFor(
      { track: 'A' },
      async () => {
        a.log('info', 'pre', {});
        const { entries: inner } = await captureLogsFor({ track: 'A' }, async () => {
          a.log('info', 'mid', {});
        });
        a.log('info', 'post', {});
        return inner;
      },
    );
    expect(outerEntries.map((e) => e.event)).toEqual(['pre', 'mid', 'post']);
    expect(innerEntries.map((e) => e.event)).toEqual(['mid']);
  });
});

describe('B-4-5 — captureLogsFor entries are chronological (FIFO)', () => {
  it('T-4-5-1: entries appear in .log() call order', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b45-'));
    const a = createTrackLogger('A', { logRoot: tmp, silent: true });
    const { entries } = await captureLogsFor({ track: 'A' }, async () => {
      for (let i = 0; i < 50; i++) {
        a.log('info', 'tick', { i });
      }
    });
    expect(entries).toHaveLength(50);
    for (let i = 0; i < 50; i++) {
      expect(entries[i]!.i).toBe(i);
    }
  });
});

describe('B-4-6 — meta-events only under track="log"', () => {
  it('T-4-6-1: capture for application track sees zero log.* events (no leak)', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b46-'));
    // Constructing this logger may emit meta-events under track='log'
    // (rotation-complete, etc.). A capture for track='A' must not see them.
    const a = createTrackLogger('A', { logRoot: tmp, silent: true });
    const { entries } = await captureLogsFor({ track: 'A' }, async () => {
      a.log('info', 'real-app-event', {});
    });
    expect(entries.every((e) => !e.event.startsWith('log.'))).toBe(true);
    expect(entries.every((e) => e.track === 'A')).toBe(true);
  });
});

// ── Meta event emission (rotation-complete / rotation-failed; disk + observer) ──

describe('Meta event emission (M3 §"a" lead decision: meta events also written to disk)', () => {
  it('rotation emits log.rotation-complete observable via captureLogsFor', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-meta-rot-'));
    await seedDateDir(tmp, 'foo', 10); // will be removed
    const { entries } = await captureLogsFor(
      { track: 'log', eventPattern: /^log\.rotation-complete$/ },
      async () => {
        createTrackLogger('foo', { logRoot: tmp });
      },
    );
    expect(entries.length).toBeGreaterThanOrEqual(1);
    // Surface §"Self-emitted meta-events" lists payload `track: string` for
    // rotation events. Impl renames to `subjectTrack` to avoid collision with
    // the entry's structural `track: 'log'`. Surface ambiguity noted in M3
    // final report.
    const evt = entries.find((e) => (e as Record<string, unknown>).subjectTrack === 'foo');
    expect(evt).toBeTruthy();
    expect(Array.isArray((evt as Record<string, unknown>).removedDirs)).toBe(true);
    // Entry's structural track is always 'log' for meta events.
    expect((evt as Record<string, unknown>).track).toBe('log');
  });

  it('rotation failure emits log.rotation-failed observable', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-meta-rotfail-'));
    const failDir = await seedDateDir(tmp, 'foo', 10);
    __setRotationRmForTests((abs) => {
      if (abs === failDir) throw new Error('synthetic-rm-failure');
      fsSync.rmSync(abs, { recursive: true, force: true });
    });
    try {
      const { entries } = await captureLogsFor(
        { track: 'log', eventPattern: /^log\.rotation-failed$/ },
        async () => {
          createTrackLogger('foo', { logRoot: tmp });
        },
      );
      expect(entries).toHaveLength(1);
      expect((entries[0] as Record<string, unknown>).dateDir).toBe(failDir);
      expect(typeof (entries[0] as Record<string, unknown>).error).toBe('string');
    } finally {
      __setRotationRmForTests(null);
    }
  });

  it('meta events ALSO land on disk under <logRoot>/log/ (B-4-6 "written under track=log")', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-meta-disk-'));
    await seedDateDir(tmp, 'foo', 10);
    createTrackLogger('foo', { logRoot: tmp });
    // Allow async write to flush (the meta-logger is lazy)
    await new Promise((r) => setTimeout(r, 50));
    const logDir = path.join(tmp, 'log');
    const dateDirs = await readdir(logDir);
    expect(dateDirs.length).toBe(1);
    const files = await readdir(path.join(logDir, dateDirs[0]!));
    expect(files.length).toBe(1);
    const content = await readFile(path.join(logDir, dateDirs[0]!, files[0]!), 'utf8');
    expect(content).toMatch(/log\.rotation-complete/);
  });
});

// ── parentTrace cross-logger trace sharing (F3 critical contract) ─────────────

describe('parentTrace — cross-module trace inheritance (F3 lead decision)', () => {
  it('child logger created via parentTrace shares trace but keeps own track', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-pt-'));
    const cli = createTrackLogger('cli', { logRoot: tmp, silent: true });
    const critic = createTrackLogger('critic', {
      logRoot: tmp,
      silent: true,
      parentTrace: cli.trace,
    });
    expect(critic.trace).toBe(cli.trace);
    expect(critic.track).toBe('critic');
    expect(cli.track).toBe('cli');

    // Filtering by trace reconstructs the full causal chain across tracks.
    const { entries } = await captureLogsFor({ track: 'cli' }, async () => {
      cli.log('info', 'audit.start', {});
    });
    const cliEntries = entries.filter((e) => e.trace === cli.trace);
    expect(cliEntries.length).toBe(1);

    const { entries: criticEntries } = await captureLogsFor({ track: 'critic' }, async () => {
      critic.log('info', 'review.start', {});
    });
    expect(criticEntries.length).toBe(1);
    expect(criticEntries[0]!.trace).toBe(cli.trace);
  });
});

// ── B-6 — durability + beforeExit hook ──────────────────────────────────────

describe('B-6-1 — flush() fsyncs writes', () => {
  it('T-6-1-1: 50 entries durable on disk after await flush()', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b61-'));
    const logger = createTrackLogger('foo', { logRoot: tmp });
    for (let i = 0; i < 50; i++) {
      logger.log('info', 'tick', { i });
    }
    await logger.flush();
    const entries = await readOnlyEntry(logger, { logRoot: tmp, track: 'foo' });
    expect(entries).toHaveLength(50);
    const iSet = new Set(entries.map((e) => e.i));
    expect(iSet.size).toBe(50);
  });
});

describe('B-6-2 — process.beforeExit flushes live loggers + emits log.beforeexit-flushed', () => {
  it('T-6-2-1: beforeExit flushes pending writes and emits log.beforeexit-flushed', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b62-'));
    const a = createTrackLogger('A', { logRoot: tmp });
    const b = createTrackLogger('B', { logRoot: tmp });
    a.log('info', 'ax', {});
    b.log('info', 'bx', {});
    // Note: NO explicit flush. beforeExit should flush them.
    const { entries: metaEntries } = await captureLogsFor(
      { track: 'log', eventPattern: /^log\.beforeexit-flushed$/ },
      async () => {
        process.emit('beforeExit', 0);
        // Allow async beforeExit handler to settle.
        await new Promise((r) => setTimeout(r, 80));
      },
    );
    expect(metaEntries.length).toBeGreaterThanOrEqual(1);
    const evt = metaEntries[0]!;
    expect(typeof (evt as Record<string, unknown>).flushedCount).toBe('number');
    expect(typeof (evt as Record<string, unknown>).durationMs).toBe('number');

    // Both files should now have their entries on disk.
    const aEntries = await readOnlyEntry(a, { logRoot: tmp, track: 'A' });
    const bEntries = await readOnlyEntry(b, { logRoot: tmp, track: 'B' });
    expect(aEntries).toHaveLength(1);
    expect(bEntries).toHaveLength(1);
  });

  it('T-6-2-2: silent logger + beforeExit is observable no-op (no error, no file)', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b62b-'));
    const logger = createTrackLogger('foo', { logRoot: tmp, silent: true });
    logger.log('info', 'x', {});
    process.emit('beforeExit', 0);
    await new Promise((r) => setTimeout(r, 30));
    await expect(stat(path.join(tmp, 'foo'))).rejects.toThrow();
  });
});

// ── B-5 — defensive serialization ────────────────────────────────────────────

describe('B-5-1 — empty event name rejected with log.invalid-event-name warn', () => {
  it('T-5-1-1: log("info", "", {}) writes no entry; emits log.invalid-event-name', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b51-'));
    const logger = createTrackLogger('foo', { logRoot: tmp });
    const { entries: metaEntries } = await captureLogsFor(
      { track: 'log', eventPattern: /^log\.invalid-event-name$/ },
      async () => {
        logger.log('info', '', {});
        await logger.flush();
      },
    );
    expect(metaEntries).toHaveLength(1);
    expect(metaEntries[0]!.level).toBe('warn');
    expect(typeof metaEntries[0]!.caller).toBe('string');

    // Application-track file should be empty (entry was dropped).
    const trackDir = path.join(tmp, 'foo');
    // The dir may or may not exist (depending on whether ensureStream ran for
    // anything else); if it does, the file should have 0 lines.
    const dateDirs = await readdir(trackDir).catch(() => [] as string[]);
    if (dateDirs.length === 0) return;
    const file = path.join(trackDir, dateDirs[0]!, `${logger.trace}.jsonl`);
    const content = await readFile(file, 'utf8').catch(() => '');
    const lines = content.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(0);
  });
});

describe('B-5-2 — circular references in data replaced with "[Circular]"', () => {
  it('T-5-2-1: shallow cycle handled (no throw; second occurrence = "[Circular]")', async () => {
    // Per surface §"Error codes" LOG-E-5 implementation hint (WeakSet + JSON
    // replacer): the cycle marker appears at the SECOND occurrence of the
    // same object reference, not at the outermost reference. Primary contract
    // is "no throw"; non-cyclic siblings preserved.
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b52-'));
    const logger = createTrackLogger('foo', { logRoot: tmp });
    const data: Record<string, unknown> = { other: 1 };
    data.circ = data;
    expect(() => logger.log('info', 'x', data)).not.toThrow();
    await logger.flush();
    const [entry] = await readOnlyEntry(logger, { logRoot: tmp, track: 'foo' });
    expect(entry.other).toBe(1);
    // entry.circ is the first encounter of `data`, so it is recursively
    // serialized; its own .circ (second encounter of `data`) is '[Circular]'.
    expect(entry.circ.other).toBe(1);
    expect(entry.circ.circ).toBe('[Circular]');
  });

  it('T-5-2-2: deep / nested cycle in data — inner cycle marked at second occurrence', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-log-b52b-'));
    const logger = createTrackLogger('foo', { logRoot: tmp });
    const inner: Record<string, unknown> = { a: 1 };
    inner.self = inner;
    const data = { wrapper: inner };
    expect(() => logger.log('info', 'x', data)).not.toThrow();
    await logger.flush();
    const [entry] = await readOnlyEntry(logger, { logRoot: tmp, track: 'foo' });
    // entry.wrapper = first encounter of `inner` — recursed normally.
    expect(entry.wrapper.a).toBe(1);
    // entry.wrapper.self = second encounter of `inner` (cycle back) → '[Circular]'.
    expect(entry.wrapper.self).toBe('[Circular]');
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
