/**
 * Tests for agent/test-result-logger helpers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  logTestCaseStart,
  logTestContextRead,
  logTestLlmCall,
  logTestResult,
} from './test-result-logger.js';
import {
  createTrackLogger,
  captureLogsFor,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from '../log-types.js';
import type { TestCaseSpec, TestCaseResult } from './test-types-stub.js';

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

const spec: TestCaseSpec = {
  id: 'login-1',
  name: 'login fails without email',
  category: 'edge-case',
  scope: { type: 'function', target: 'fn:handleLogin', file: '/tmp/x.ts', line: 10 },
  given: 'no email',
  when: 'handleLogin called',
  then: 'throws email required',
  reasoning: 'input validation',
};

describe('test-result-logger helpers', () => {
  it('emits agent.test-run.case.start with full spec metadata', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const out = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\.test-run\./ },
      async () => {
        logTestCaseStart(logger, spec);
        await logger.flush();
        return null;
      },
    );
    const ev = out.entries.find((e) => e.event === 'agent.test-run.case.start');
    expect(ev).toBeDefined();
    expect(ev!.specId).toBe('login-1');
    expect(ev!.category).toBe('edge-case');
    expect(ev!.line).toBe(10);
  });

  it('emits agent.test-run.case.context-read with line bounds', async () => {
    const logger = createTrackLogger('agent', { silent: true, minLevel: 'debug' });
    const out = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\.test-run\./ },
      async () => {
        logTestContextRead(logger, {
          file: '/tmp/x.ts',
          lineStart: 5,
          lineEnd: 35,
          snippet: 'lorem '.repeat(60),
        });
        await logger.flush();
        return null;
      },
    );
    const ev = out.entries.find((e) => e.event === 'agent.test-run.case.context-read');
    expect(ev).toBeDefined();
    expect(ev!.lines).toBe(31);
    expect((ev!.snippetPreview as string).length).toBeLessThanOrEqual(200);
  });

  it('emits three distinct llm-call events (start / success / failure)', async () => {
    const logger = createTrackLogger('agent', { silent: true, minLevel: 'debug' });
    const out = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\.test-run\.case\.llm-call/ },
      async () => {
        logTestLlmCall(logger, {
          specId: 'x',
          model: 'fake',
          promptLen: 100,
          phase: 'start',
        });
        logTestLlmCall(logger, {
          specId: 'x',
          model: 'fake',
          promptLen: 100,
          phase: 'success',
          rawLen: 200,
          durationMs: 50,
        });
        logTestLlmCall(logger, {
          specId: 'x',
          model: 'fake',
          promptLen: 100,
          phase: 'failure',
          error: 'boom',
          durationMs: 10,
        });
        await logger.flush();
        return null;
      },
    );
    const events = out.entries.map((e) => e.event);
    expect(events).toContain('agent.test-run.case.llm-call.start');
    expect(events).toContain('agent.test-run.case.llm-call.success');
    expect(events).toContain('agent.test-run.case.llm-call.failure');
    const failEv = out.entries.find(
      (e) => e.event === 'agent.test-run.case.llm-call.failure',
    );
    expect(failEv?.level).toBe('warn');
  });

  it('emits agent.test-run.case.complete at warn for fail, info otherwise', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const passResult: TestCaseResult = {
      spec,
      status: 'pass',
      verdictReason: 'looks good',
      evidence: { file: '/tmp/x.ts', line: 10, snippet: 'ok' },
      criticFamily: 'openai',
      durationMs: 5,
    };
    const failResult: TestCaseResult = {
      ...passResult,
      status: 'fail',
      verdictReason: 'broken',
    };
    const out = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\.test-run\.case\.complete/ },
      async () => {
        logTestResult(logger, passResult);
        logTestResult(logger, failResult);
        await logger.flush();
        return null;
      },
    );
    const ev = out.entries.filter((e) => e.event === 'agent.test-run.case.complete');
    expect(ev).toHaveLength(2);
    const levels = ev.map((e) => e.level);
    expect(levels).toContain('info');
    expect(levels).toContain('warn');
  });

  it('does not throw when logger is malformed (defensive contract)', () => {
    const badLogger = {} as unknown as Parameters<typeof logTestCaseStart>[0];
    expect(() => logTestCaseStart(badLogger, spec)).not.toThrow();
    expect(() =>
      logTestContextRead(badLogger, {
        file: 'x',
        lineStart: 1,
        lineEnd: 2,
        snippet: 'y',
      }),
    ).not.toThrow();
    expect(() =>
      logTestLlmCall(badLogger, {
        specId: 'x',
        model: 'm',
        promptLen: 1,
        phase: 'start',
      }),
    ).not.toThrow();
    expect(() =>
      logTestResult(badLogger, {
        spec,
        status: 'pass',
        verdictReason: '',
        evidence: {},
        criticFamily: null,
        durationMs: 0,
      }),
    ).not.toThrow();
  });
});
