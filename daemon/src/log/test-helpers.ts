/**
 * Test-only helpers for the log module.
 *
 * Surface: `docs/details/12-log-module-public-surface.md` §"Importable symbols"
 * (the `captureLogsFor` export).
 *
 * Phase 2 implementation. NOT for production runtime — observer registry is
 * unbounded (relies on every captureLogsFor to clean up via try/finally).
 */

import {
  __addLogObserver,
  __removeLogObserver,
  type LogEntry,
} from './track-logger.js';

export interface CaptureOptions {
  track?: string;
  eventPattern?: RegExp;
}

export async function captureLogsFor<T>(
  opts: CaptureOptions & { track: string },
  fn: () => Promise<T>,
): Promise<{ result: T; entries: LogEntry[] }> {
  const obs = __addLogObserver({ track: opts.track, eventPattern: opts.eventPattern });
  try {
    const result = await fn();
    return { result, entries: obs.entries.slice() };
  } finally {
    __removeLogObserver(obs.id);
  }
}
