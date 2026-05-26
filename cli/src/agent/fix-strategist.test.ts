/**
 * Tests for agent/fix-strategist.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chooseFixStrategy } from './fix-strategist.js';
import { createTrackLogger, captureLogsFor } from '../log-types.js';
import {
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from '../log-types.js';
import type { LoadedPreset, VerdictedFinding } from '../stubs.js';

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

function makePreset(fixKind: 'template' | 'llm-only' | 'none' = 'template'): LoadedPreset {
  return {
    manifest: {
      id: 'p',
      version: 1,
      rules: [
        {
          id: 'r',
          severity: 'P1',
          mechanism: 'static-grep',
          pattern: 'X',
          ...(fixKind === 'none'
            ? {}
            : {
                fix:
                  fixKind === 'template'
                    ? { kind: 'template', find: 'X', replace: 'Y', verifyCommand: 'true' }
                    : { kind: 'llm-only' as const },
              }),
        },
      ],
      body: '',
    },
    source: 'builtin',
    resolvedPath: '<test>',
    shadowedBy: [],
  };
}

function makeFinding(verdict: VerdictedFinding['verdict'] = 'confirmed'): VerdictedFinding {
  return {
    id: 'p.r.f.ts:1',
    presetId: 'p',
    ruleId: 'r',
    severity: 'P1',
    file: 'f.ts',
    line: 1,
    evidence: 'X',
    message: 'matched',
    verdict,
  };
}

describe('fix-strategist.chooseFixStrategy', () => {
  it('returns template when verdict=confirmed and rule.fix.kind=template', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const cap = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\.fix-strategy\./ },
      async () =>
        chooseFixStrategy({
          finding: makeFinding('confirmed'),
          preset: makePreset('template'),
          cwd: '/tmp',
          logger,
          criticConfig: null,
          criticApiKey: null,
        }),
    );
    expect(cap.result.approach).toBe('template');
    const events = cap.entries.map((e) => e.event);
    expect(events).toContain('agent.fix-strategy.start');
    expect(events).toContain('agent.fix-strategy.template-chosen');
  });

  it('returns llm-only when verdict=confirmed and rule.fix.kind=llm-only', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const out = await chooseFixStrategy({
      finding: makeFinding('confirmed'),
      preset: makePreset('llm-only'),
      cwd: '/tmp',
      logger,
      criticConfig: null,
      criticApiKey: null,
    });
    expect(out.approach).toBe('llm-only');
  });

  it('returns manual-only when verdict=needs-context', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const out = await chooseFixStrategy({
      finding: makeFinding('needs-context'),
      preset: makePreset('template'),
      cwd: '/tmp',
      logger,
      criticConfig: null,
      criticApiKey: null,
    });
    expect(out.approach).toBe('manual-only');
    expect(out.reasoning).toContain('human context');
  });

  it('returns manual-only when rule has no fix declared', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const out = await chooseFixStrategy({
      finding: makeFinding('confirmed'),
      preset: makePreset('none'),
      cwd: '/tmp',
      logger,
      criticConfig: null,
      criticApiKey: null,
    });
    expect(out.approach).toBe('manual-only');
  });

  it('throws when called on false-positive', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    await expect(
      chooseFixStrategy({
        finding: makeFinding('false-positive'),
        preset: makePreset('template'),
        cwd: '/tmp',
        logger,
        criticConfig: null,
        criticApiKey: null,
      }),
    ).rejects.toThrow(/non-actionable/);
  });

  it('throws when called on critic-unavailable', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    await expect(
      chooseFixStrategy({
        finding: makeFinding('critic-unavailable'),
        preset: makePreset('template'),
        cwd: '/tmp',
        logger,
        criticConfig: null,
        criticApiKey: null,
      }),
    ).rejects.toThrow(/non-actionable/);
  });
});
