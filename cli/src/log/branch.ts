/**
 * Forced decision-branch logging helper. Use at EVERY if/else / switch /
 * try/catch in code that the user might want to trace.
 *
 * Convention: event name 'scope.decision-point.outcome'.
 *   e.g. 'preset.file.scan-decision' with outcome 'scan' | 'skip'
 *
 * Default level: 'debug' (only visible with --log-level=debug).
 * If decision is consequential (impacts user-visible behavior), pass level='info'.
 *
 * Safety: if `logger` is null/undefined or `.log` isn't callable, the helper
 * silently no-ops. Decision-branch logging must NEVER crash production code
 * just because a caller forgot to pass a logger.
 */
import type { TrackLogger } from '../log-types.js';

export interface LogBranchData {
  decision: string;
  reasoning?: string;
  [k: string]: unknown;
}

export interface LogBranchOptions {
  level?: 'debug' | 'info';
}

export function logBranch(
  logger: TrackLogger | null | undefined,
  event: string,
  data: LogBranchData,
  opts?: LogBranchOptions,
): void {
  if (!logger || typeof logger.log !== 'function') return;
  const level = opts?.level ?? 'debug';
  try {
    logger.log(level, event, data);
  } catch {
    // Logging must never throw to callers. Swallow.
  }
}

/**
 * Convenience: log an exception branch (catch arm) with a stack hint.
 * Always emits at warn level since reaching a catch is by definition an
 * anomaly worth surfacing in default log output.
 */
export function logCatch(
  logger: TrackLogger | null | undefined,
  event: string,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  if (!logger || typeof logger.log !== 'function') return;
  const msg = error instanceof Error ? error.message : String(error);
  try {
    logger.log('warn', event, {
      decision: 'catch-and-recover',
      error: msg.slice(0, 300),
      ...extra,
    });
  } catch {
    // swallow
  }
}
