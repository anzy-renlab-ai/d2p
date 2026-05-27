/**
 * Bounded-concurrency runner — wraps `p-limit` with try/catch and
 * decision-branch logging so per-task failures never poison sibling
 * in-flight tasks.
 *
 * Phase 11.1 — Audit Parallelization.
 *
 * Design: docs/reviews/2026-05-27-audit-parallelization.md
 *
 * Semantics:
 *   - `runConcurrent` NEVER rejects. Each task's result is captured into
 *     `ConcurrentTaskResult<T>` with `ok=true|false`.
 *   - Order is preserved: results[i] corresponds to tasks[i].
 *   - AbortSignal short-circuits PENDING tasks: not-yet-started entries
 *     resolve with ok=false + error=AbortError; in-flight tasks must check
 *     the signal themselves (we forward it via opts so callers may pass it
 *     to fetch / AbortSignal.any).
 *   - Emits `<branchPrefix>.task.start` and `<branchPrefix>.task.complete`
 *     events when a logger + branchPrefix is supplied.
 */
import pLimit from 'p-limit';
import type { TrackLogger } from '../log-types.js';
import { logBranch } from '../log/branch.js';

export interface RunConcurrentOpts {
  /** Hard cap on in-flight tasks. Values < 1 are coerced to 1. */
  maxInFlight: number;
  logger?: TrackLogger;
  /** Optional event-name prefix for branch logging, e.g. 'agent.test-run.batch'. */
  branchPrefix?: string;
  /** Optional AbortSignal to short-circuit pending tasks. */
  signal?: AbortSignal;
}

export interface ConcurrentTaskResult<T> {
  index: number;
  ok: boolean;
  value?: T;
  error?: Error;
  durationMs: number;
}

/**
 * Run async tasks with bounded concurrency. NEVER rejects. Order preserved.
 *
 * The supplied AbortSignal short-circuits queued (not-yet-started) tasks
 * with an AbortError. In-flight tasks receive cooperative cancellation
 * only if they listen to the signal themselves — callers should plumb
 * `opts.signal` into their fetch/timer logic.
 */
export async function runConcurrent<T>(
  tasks: Array<() => Promise<T>>,
  opts: RunConcurrentOpts,
): Promise<ConcurrentTaskResult<T>[]> {
  const total = tasks.length;
  if (total === 0) return [];

  const cap = Math.max(1, Math.floor(opts.maxInFlight));
  const limit = pLimit(cap);
  const branchPrefix = opts.branchPrefix ?? 'agent.concurrency';

  const runOne = (fn: () => Promise<T>, index: number): Promise<ConcurrentTaskResult<T>> => {
    return limit(async () => {
      // Honor abort signal — skip pending tasks once aborted.
      if (opts.signal?.aborted) {
        const err = new Error('aborted');
        (err as Error).name = 'AbortError';
        logBranch(opts.logger, `${branchPrefix}.task.complete`, {
          decision: 'aborted-before-start',
          index,
          total,
          ok: false,
          durationMs: 0,
        });
        return { index, ok: false, error: err, durationMs: 0 };
      }
      const start = Date.now();
      logBranch(opts.logger, `${branchPrefix}.task.start`, {
        decision: 'task-start',
        index,
        total,
      });
      try {
        const value = await fn();
        const durationMs = Date.now() - start;
        logBranch(opts.logger, `${branchPrefix}.task.complete`, {
          decision: 'task-success',
          index,
          total,
          ok: true,
          durationMs,
        });
        return { index, ok: true, value, durationMs };
      } catch (e) {
        const durationMs = Date.now() - start;
        const err = e instanceof Error ? e : new Error(String(e));
        logBranch(opts.logger, `${branchPrefix}.task.complete`, {
          decision: 'task-failure',
          index,
          total,
          ok: false,
          durationMs,
          error: err.message.slice(0, 200),
        });
        return { index, ok: false, error: err, durationMs };
      }
    });
  };

  const promises = tasks.map((t, i) => runOne(t, i));
  const settled = await Promise.all(promises);
  // Results from p-limit preserve submission order because we mapped 1:1
  // and Promise.all preserves index order.
  return settled;
}
