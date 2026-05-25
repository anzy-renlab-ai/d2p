/**
 * Sanity tests for captureLogsFor itself (DUCKPLAN M3.4 — 5 tests).
 *
 * Surface: `docs/details/12-log-module-public-surface.md` §"Importable symbols".
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  createTrackLogger,
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

describe('captureLogsFor sanity', () => {
  it('returns { result, entries } with the fn return value', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-helpers-r1-'));
    const a = createTrackLogger('A', { logRoot: tmp, silent: true });
    const out = await captureLogsFor({ track: 'A' }, async () => {
      a.log('info', 'x', {});
      return 'sentinel';
    });
    expect(out.result).toBe('sentinel');
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0]!.event).toBe('x');
  });

  it('observer registry isolation: 3 concurrent captures do not cross-talk', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-helpers-r2-'));
    const a = createTrackLogger('A', { logRoot: tmp, silent: true });
    const b = createTrackLogger('B', { logRoot: tmp, silent: true });
    const c = createTrackLogger('C', { logRoot: tmp, silent: true });
    const [ra, rb, rc] = await Promise.all([
      captureLogsFor({ track: 'A' }, async () => {
        for (let i = 0; i < 3; i++) {
          a.log('info', 'ae', { i });
          await Promise.resolve();
        }
      }),
      captureLogsFor({ track: 'B' }, async () => {
        for (let i = 0; i < 3; i++) {
          b.log('info', 'be', { i });
          await Promise.resolve();
        }
      }),
      captureLogsFor({ track: 'C' }, async () => {
        for (let i = 0; i < 3; i++) {
          c.log('info', 'ce', { i });
          await Promise.resolve();
        }
      }),
    ]);
    expect(ra.entries.every((e) => e.track === 'A')).toBe(true);
    expect(rb.entries.every((e) => e.track === 'B')).toBe(true);
    expect(rc.entries.every((e) => e.track === 'C')).toBe(true);
    expect(ra.entries).toHaveLength(3);
    expect(rb.entries).toHaveLength(3);
    expect(rc.entries).toHaveLength(3);
  });

  it('always-cleanup on async fn throw (no leaked observer for next capture)', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-helpers-r3-'));
    const a = createTrackLogger('A', { logRoot: tmp, silent: true });
    await expect(
      captureLogsFor({ track: 'A' }, async () => {
        a.log('info', 'before-throw', {});
        throw new Error('boom-async');
      }),
    ).rejects.toThrow('boom-async');
    // A subsequent capture on a DIFFERENT track should see only its own writes
    // (no leaked observer for track A grabbing entries).
    const r = await captureLogsFor({ track: 'B' }, async () => {
      a.log('info', 'after', {}); // would land in leaked A observer if any
    });
    expect(r.entries).toHaveLength(0);
  });

  it('always-cleanup on synchronous throw inside fn', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-helpers-r4-'));
    await expect(
      captureLogsFor({ track: 'A' }, async () => {
        (null as unknown as { foo: () => void }).foo();
      }),
    ).rejects.toThrow();
    // Subsequent capture works normally
    const r = await captureLogsFor({ track: 'C' }, async () => {
      // empty fn
    });
    expect(r.entries).toHaveLength(0);
  });

  it('meta-event leak prevention (B-4-6): capturing app-track sees zero log.* events', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-helpers-r5-'));
    // Construct logger which may trigger rotation-complete (under track='log')
    const a = createTrackLogger('A', { logRoot: tmp, silent: true });
    const r = await captureLogsFor({ track: 'A' }, async () => {
      a.log('info', 'real-app-event', {});
    });
    expect(r.entries.every((e) => e.track === 'A')).toBe(true);
    expect(r.entries.every((e) => !e.event.startsWith('log.'))).toBe(true);
  });
});
