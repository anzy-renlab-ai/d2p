/**
 * Tests for `logBranch` / `logCatch` helpers.
 *
 * The helpers must:
 *  - default to 'debug' level
 *  - escalate to 'info' when opts.level='info'
 *  - never throw when logger is null/undefined or .log is not a function
 *  - extract Error.message for `logCatch`; coerce non-Error to String()
 *  - truncate long error messages to ≤300 chars
 *  - merge `extra` keys into the catch payload
 *  - propagate `decision`/`reasoning`/extra keys into the event payload
 */
import { describe, it, expect, vi } from 'vitest';
import type { TrackLogger, LogLevel } from '../log-types.js';
import { logBranch, logCatch } from './branch.js';

interface Captured {
  level: LogLevel;
  event: string;
  data: Record<string, unknown> | undefined;
}

function makeLogger(): { logger: TrackLogger; entries: Captured[] } {
  const entries: Captured[] = [];
  const logger: TrackLogger = {
    track: 'test',
    trace: 'TEST-TRACE',
    log: (level, event, data) => {
      entries.push({ level, event, data });
    },
    child(_scope: string) {
      return this;
    },
    flush: async () => {},
  };
  return { logger, entries };
}

describe('logBranch', () => {
  it('defaults to debug level', () => {
    const { logger, entries } = makeLogger();
    logBranch(logger, 'scope.decision.outcome', {
      decision: 'taken',
      reasoning: 'x',
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.level).toBe('debug');
    expect(entries[0]!.event).toBe('scope.decision.outcome');
    expect(entries[0]!.data).toEqual({ decision: 'taken', reasoning: 'x' });
  });

  it("escalates to info when opts.level === 'info'", () => {
    const { logger, entries } = makeLogger();
    logBranch(
      logger,
      'scope.decision.outcome',
      { decision: 'consequential' },
      { level: 'info' },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.level).toBe('info');
  });

  it('forwards arbitrary extra keys via spread', () => {
    const { logger, entries } = makeLogger();
    logBranch(logger, 'preset.rule.scan-decision', {
      decision: 'scan',
      ruleId: 'stripe-live-key',
      filesEligible: 4,
    });
    expect(entries[0]!.data).toMatchObject({
      decision: 'scan',
      ruleId: 'stripe-live-key',
      filesEligible: 4,
    });
  });

  it('does not throw when logger is null', () => {
    expect(() =>
      logBranch(null, 'evt', { decision: 'noop' }),
    ).not.toThrow();
  });

  it('does not throw when logger is undefined', () => {
    expect(() =>
      logBranch(undefined, 'evt', { decision: 'noop' }),
    ).not.toThrow();
  });

  it('does not throw when logger lacks .log method', () => {
    const broken = {} as unknown as TrackLogger;
    expect(() => logBranch(broken, 'evt', { decision: 'x' })).not.toThrow();
  });

  it('swallows exceptions thrown by logger.log', () => {
    const logger: TrackLogger = {
      track: 't',
      trace: 'TR',
      log: vi.fn().mockImplementation(() => {
        throw new Error('underlying log failed');
      }),
      child() {
        return this;
      },
      flush: async () => {},
    };
    expect(() =>
      logBranch(logger, 'evt', { decision: 'x' }),
    ).not.toThrow();
  });
});

describe('logCatch', () => {
  it('captures Error.message and emits at warn level', () => {
    const { logger, entries } = makeLogger();
    logCatch(logger, 'preset.file.read-failed', new Error('ENOENT no file'), {
      file: '/tmp/x.ts',
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.level).toBe('warn');
    expect(entries[0]!.event).toBe('preset.file.read-failed');
    expect(entries[0]!.data).toMatchObject({
      decision: 'catch-and-recover',
      error: 'ENOENT no file',
      file: '/tmp/x.ts',
    });
  });

  it('coerces non-Error throwables to String()', () => {
    const { logger, entries } = makeLogger();
    logCatch(logger, 'evt', 'plain string thrown');
    expect(entries[0]!.data!.error).toBe('plain string thrown');
  });

  it('truncates error messages to 300 chars', () => {
    const { logger, entries } = makeLogger();
    const long = 'x'.repeat(1000);
    logCatch(logger, 'evt', new Error(long));
    const err = entries[0]!.data!.error as string;
    expect(err.length).toBe(300);
  });

  it('does not throw when logger is null', () => {
    expect(() => logCatch(null, 'evt', new Error('x'))).not.toThrow();
  });

  it('does not throw when logger lacks .log', () => {
    expect(() =>
      logCatch({} as unknown as TrackLogger, 'evt', new Error('x')),
    ).not.toThrow();
  });
});
