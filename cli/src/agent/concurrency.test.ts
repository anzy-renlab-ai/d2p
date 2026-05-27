/**
 * Tests for agent/concurrency — bounded parallel runner.
 *
 * Phase 11.1 — Audit Parallelization.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runConcurrent } from './concurrency.js';
import {
  createTrackLogger,
  captureLogsFor,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from '../log-types.js';

beforeEach(() => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
});
afterEach(() => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('runConcurrent', () => {
  it('returns empty array for empty input', async () => {
    const out = await runConcurrent([], { maxInFlight: 5 });
    expect(out).toEqual([]);
  });

  it('runs a single task and returns one result', async () => {
    const out = await runConcurrent([async () => 42], { maxInFlight: 5 });
    expect(out).toHaveLength(1);
    expect(out[0]!.ok).toBe(true);
    expect(out[0]!.value).toBe(42);
    expect(out[0]!.index).toBe(0);
  });

  it('preserves order regardless of completion timing', async () => {
    const tasks = [
      async () => {
        await sleep(60);
        return 'a';
      },
      async () => {
        await sleep(10);
        return 'b';
      },
      async () => {
        await sleep(40);
        return 'c';
      },
      async () => {
        await sleep(5);
        return 'd';
      },
    ];
    const out = await runConcurrent(tasks, { maxInFlight: 4 });
    expect(out.map((r) => r.value)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('caps in-flight at N=5 with 20 tasks (peak observed ≤ 5)', async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks: Array<() => Promise<number>> = [];
    for (let i = 0; i < 20; i++) {
      tasks.push(async () => {
        inFlight++;
        if (inFlight > peak) peak = inFlight;
        await sleep(20);
        inFlight--;
        return i;
      });
    }
    const out = await runConcurrent(tasks, { maxInFlight: 5 });
    expect(out).toHaveLength(20);
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1); // sanity — concurrency actually happened
    // All values present in order
    expect(out.map((r) => r.value)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('captures individual task errors and continues others', async () => {
    const tasks = [
      async () => 'ok1',
      async () => {
        throw new Error('boom');
      },
      async () => 'ok2',
    ];
    const out = await runConcurrent(tasks, { maxInFlight: 3 });
    expect(out[0]!.ok).toBe(true);
    expect(out[0]!.value).toBe('ok1');
    expect(out[1]!.ok).toBe(false);
    expect(out[1]!.error?.message).toBe('boom');
    expect(out[2]!.ok).toBe(true);
    expect(out[2]!.value).toBe('ok2');
  });

  it('when N > tasks.length, effective concurrency = task count', async () => {
    let peak = 0;
    let inFlight = 0;
    const tasks = [1, 2, 3].map((v) => async () => {
      inFlight++;
      if (inFlight > peak) peak = inFlight;
      await sleep(15);
      inFlight--;
      return v;
    });
    const out = await runConcurrent(tasks, { maxInFlight: 50 });
    expect(out).toHaveLength(3);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('AbortSignal short-circuits pending tasks', async () => {
    const ctl = new AbortController();
    const tasks: Array<() => Promise<string>> = [];
    for (let i = 0; i < 10; i++) {
      tasks.push(async () => {
        await sleep(50);
        return `t${i}`;
      });
    }
    // Abort almost immediately so most tasks are still queued.
    setTimeout(() => ctl.abort(), 5);
    const out = await runConcurrent(tasks, { maxInFlight: 2, signal: ctl.signal });
    expect(out).toHaveLength(10);
    const aborted = out.filter((r) => !r.ok && r.error?.name === 'AbortError');
    expect(aborted.length).toBeGreaterThan(0);
  });

  it('emits task.start and task.complete events when logger supplied', async () => {
    const logger = createTrackLogger('agent', { silent: true, minLevel: 'debug' });
    const { result, entries } = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\.concurrency\./ },
      async () =>
        runConcurrent(
          [
            async () => 1,
            async () => {
              throw new Error('x');
            },
          ],
          {
            maxInFlight: 2,
            logger,
            branchPrefix: 'agent.concurrency',
          },
        ),
    );
    expect(result).toHaveLength(2);
    const events = entries.map((e) => e.event);
    expect(events).toContain('agent.concurrency.task.start');
    expect(events).toContain('agent.concurrency.task.complete');
  });

  it('coerces maxInFlight < 1 to 1', async () => {
    const out = await runConcurrent([async () => 'a', async () => 'b'], {
      maxInFlight: 0,
    });
    expect(out.map((r) => r.value)).toEqual(['a', 'b']);
  });
});
