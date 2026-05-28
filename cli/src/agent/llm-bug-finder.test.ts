/**
 * Tests for agent/llm-bug-finder.
 *
 * Strategy: inject a mock BugFinderLlmFn so tests are hermetic. No real
 * network calls. We assert validation gates (line range, enums, confidence
 * filter) and the inferredBugToFinding mapping.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  findBugsViaLLM,
  inferredBugToFinding,
  parseBugsFromRaw,
  type BugFinderLlmFn,
  type InferredBug,
} from './llm-bug-finder.js';
import {
  createTrackLogger,
  captureLogsFor,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from '../log-types.js';
import type { EngineConfig } from '../stubs.js';
import type { FunctionInfo } from './ast-analyzer.js';

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

// ── Fixtures ────────────────────────────────────────────────────────────────

const fakeConfig: EngineConfig = {
  kind: 'openai-compat',
  modelId: 'fake-model',
  releaseDate: '2026-01-01',
  baseUrl: 'https://example.com/v1',
  apiKey: 'unused-here',
};

function makeFn(overrides: Partial<FunctionInfo> = {}): FunctionInfo {
  return {
    file: 'src/handlers/login.ts',
    line: 10,
    name: 'handleLogin',
    kind: 'function',
    params: [{ name: 'req', typeHint: null }],
    returnTypeHint: null,
    branchCount: 2,
    hasAsyncCall: true,
    hasDatabaseCall: false,
    hasNetworkCall: false,
    sourceSnippet: [
      'export async function handleLogin(req) {',
      '  const { email, pw } = req.body;',
      '  const user = await db.findUser(email);',
      '  if (user.password == pw) {',
      '    return { token: signToken(user) };',
      '  }',
      '  return null;',
      '}',
    ].join('\n'),
    ...overrides,
  };
}

function mockCallerReturning(raw: string): BugFinderLlmFn {
  return async () => ({ rawText: raw, durationMs: 5 });
}

function mockCallerThrowing(message: string): BugFinderLlmFn {
  return async () => {
    throw new Error(message);
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('llm-bug-finder.findBugsViaLLM', () => {
  it('with mock LLM returning a bug → bug appears in result', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const fn = makeFn();
    const llm = mockCallerReturning(
      JSON.stringify([
        {
          bugType: 'logic',
          line: 13,
          severity: 'P1',
          confidence: 'high',
          oneLineDesc: 'plaintext password compare via ==',
          rationale:
            'The comparison uses == which is loose equality on a security-critical path; passwords are compared in plaintext.',
          codeSnippet: '  if (user.password == pw) {',
        },
      ]),
    );
    const out = await findBugsViaLLM({
      cwd: '/tmp',
      functions: [fn],
      criticConfig: fakeConfig,
      criticApiKey: 'sk-test',
      logger,
      callLLM: llm,
      concurrency: 1,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.bugType).toBe('logic');
    expect(out[0]!.severity).toBe('P1');
    expect(out[0]!.line).toBe(13);
    expect(out[0]!.file).toBe('src/handlers/login.ts');
    expect(out[0]!.fnId).toContain('handleLogin');
  });

  it('with mock LLM returning [] → no bugs found', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const fn = makeFn();
    const llm = mockCallerReturning('[]');
    const out = await findBugsViaLLM({
      cwd: '/tmp',
      functions: [fn],
      criticConfig: fakeConfig,
      criticApiKey: 'sk-test',
      logger,
      callLLM: llm,
      concurrency: 1,
    });
    expect(out).toEqual([]);
  });

  it('malformed JSON → graceful empty result + decision log', async () => {
    const logger = createTrackLogger('agent', { silent: true, minLevel: 'debug' });
    const fn = makeFn();
    const llm = mockCallerReturning('this is not json at all');
    const { result, entries } = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\.llm-detect\./ },
      async () =>
        findBugsViaLLM({
          cwd: '/tmp',
          functions: [fn],
          criticConfig: fakeConfig,
          criticApiKey: 'sk-test',
          logger,
          callLLM: llm,
          concurrency: 1,
        }),
    );
    expect(result).toEqual([]);
    const events = entries.map((e) => e.event);
    expect(events).toContain('agent.llm-detect.fn.parse-decision');
  });

  it('line out of range → entry dropped + decision log', async () => {
    const logger = createTrackLogger('agent', { silent: true, minLevel: 'debug' });
    const fn = makeFn(); // covers lines 10-17 (~8 lines)
    const llm = mockCallerReturning(
      JSON.stringify([
        {
          bugType: 'logic',
          line: 9999, // way out of range
          severity: 'P1',
          confidence: 'high',
          oneLineDesc: 'something wrong',
          rationale: 'reason',
          codeSnippet: 'foo',
        },
      ]),
    );
    const { result, entries } = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\.llm-detect\./ },
      async () =>
        findBugsViaLLM({
          cwd: '/tmp',
          functions: [fn],
          criticConfig: fakeConfig,
          criticApiKey: 'sk-test',
          logger,
          callLLM: llm,
          concurrency: 1,
        }),
    );
    expect(result).toEqual([]);
    const events = entries.map((e) => e.event);
    expect(events).toContain('agent.llm-detect.fn.bug-dropped');
  });

  it('invalid severity → entry dropped', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const fn = makeFn();
    const llm = mockCallerReturning(
      JSON.stringify([
        {
          bugType: 'logic',
          line: 13,
          severity: 'CRITICAL', // not P1/P2/P3
          confidence: 'high',
          oneLineDesc: 'something',
          rationale: 'reason',
          codeSnippet: 'snip',
        },
      ]),
    );
    const out = await findBugsViaLLM({
      cwd: '/tmp',
      functions: [fn],
      criticConfig: fakeConfig,
      criticApiKey: 'sk-test',
      logger,
      callLLM: llm,
      concurrency: 1,
    });
    expect(out).toEqual([]);
  });

  it('invalid confidence → entry dropped', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const fn = makeFn();
    const llm = mockCallerReturning(
      JSON.stringify([
        {
          bugType: 'logic',
          line: 13,
          severity: 'P1',
          confidence: 'maybe', // invalid
          oneLineDesc: 'something',
          rationale: 'reason',
          codeSnippet: 'snip',
        },
      ]),
    );
    const out = await findBugsViaLLM({
      cwd: '/tmp',
      functions: [fn],
      criticConfig: fakeConfig,
      criticApiKey: 'sk-test',
      logger,
      callLLM: llm,
      concurrency: 1,
    });
    expect(out).toEqual([]);
  });

  it('maxFunctions cap enforced', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const fns: FunctionInfo[] = [];
    for (let i = 0; i < 50; i++) {
      fns.push(
        makeFn({
          file: `src/handlers/h${i}.ts`,
          name: `fn${i}`,
          line: 10,
        }),
      );
    }
    let callCount = 0;
    const llm: BugFinderLlmFn = async () => {
      callCount++;
      return { rawText: '[]', durationMs: 1 };
    };
    await findBugsViaLLM({
      cwd: '/tmp',
      functions: fns,
      criticConfig: fakeConfig,
      criticApiKey: 'sk-test',
      logger,
      callLLM: llm,
      concurrency: 5,
      maxFunctions: 7,
    });
    expect(callCount).toBe(7);
  });

  it('concurrency enforced (mock LLM tracks in-flight)', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const fns: FunctionInfo[] = [];
    for (let i = 0; i < 10; i++) {
      fns.push(makeFn({ file: `src/handlers/h${i}.ts`, name: `fn${i}` }));
    }
    let inFlight = 0;
    let peakInFlight = 0;
    const llm: BugFinderLlmFn = async () => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return { rawText: '[]', durationMs: 20 };
    };
    await findBugsViaLLM({
      cwd: '/tmp',
      functions: fns,
      criticConfig: fakeConfig,
      criticApiKey: 'sk-test',
      logger,
      callLLM: llm,
      concurrency: 3,
    });
    expect(peakInFlight).toBeLessThanOrEqual(3);
    expect(peakInFlight).toBeGreaterThan(0);
  });

  it('LLM throw → individual function fails but batch continues', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const fns = [
      makeFn({ name: 'first', file: 'src/a.ts' }),
      makeFn({ name: 'second', file: 'src/b.ts' }),
    ];
    let call = 0;
    const llm: BugFinderLlmFn = async () => {
      call++;
      if (call === 1) throw new Error('boom timeout');
      return {
        rawText: JSON.stringify([
          {
            bugType: 'security',
            line: 13,
            severity: 'P2',
            confidence: 'high',
            oneLineDesc: 'second-fn bug',
            rationale: 'reason here',
            codeSnippet: 'code',
          },
        ]),
        durationMs: 5,
      };
    };
    const out = await findBugsViaLLM({
      cwd: '/tmp',
      functions: fns,
      criticConfig: fakeConfig,
      criticApiKey: 'sk-test',
      logger,
      callLLM: llm,
      concurrency: 1,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.oneLineDesc).toBe('second-fn bug');
  });

  it('inferredBugToFinding() maps fields correctly', () => {
    const bug: InferredBug = {
      fnId: 'handleLogin@src/handlers/login.ts:10',
      file: 'src/handlers/login.ts',
      line: 13,
      bugType: 'security',
      severity: 'P1',
      oneLineDesc: 'plaintext password compare',
      rationale: 'Reason explained here.',
      codeSnippet: 'if (user.password == pw) {',
      confidence: 'high',
    };
    const finding = inferredBugToFinding(bug, 0);
    expect(finding.presetId).toBe('llm-detect-security');
    expect(finding.ruleId).toBe('llm-detect-security');
    expect(finding.severity).toBe('P1');
    expect(finding.file).toBe('src/handlers/login.ts');
    expect(finding.line).toBe(13);
    expect(finding.message).toBe('plaintext password compare');
    expect(finding.id).toContain('llm-detect-security');
    expect(finding.id).toContain('src/handlers/login.ts:13');
    const ev = JSON.parse(finding.evidence) as {
      snippet: string;
      expectedBehavior: string;
      actualBehavior: string;
      confidence: string;
    };
    expect(ev.snippet).toBe('if (user.password == pw) {');
    expect(ev.expectedBehavior).toBe('plaintext password compare');
    expect(ev.actualBehavior).toBe('Reason explained here.');
    expect(ev.confidence).toBe('high');
  });

  it('inferredBugToFinding maps performance category to "perf" rule slug', () => {
    const bug: InferredBug = {
      fnId: 'foo@a.ts:1',
      file: 'a.ts',
      line: 2,
      bugType: 'performance',
      severity: 'P3',
      oneLineDesc: 'N+1 query',
      rationale: 'N+1 in a loop.',
      codeSnippet: 'for (...) db.query',
      confidence: 'medium',
    };
    const finding = inferredBugToFinding(bug, 0);
    expect(finding.presetId).toBe('llm-detect-performance');
    expect(finding.ruleId).toBe('llm-detect-perf');
  });

  it('empty function list → empty array (no LLM calls)', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    let calls = 0;
    const llm: BugFinderLlmFn = async () => {
      calls++;
      return { rawText: '[]', durationMs: 1 };
    };
    const out = await findBugsViaLLM({
      cwd: '/tmp',
      functions: [],
      criticConfig: fakeConfig,
      criticApiKey: 'sk-test',
      logger,
      callLLM: llm,
    });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });

  it('start + complete decision events logged', async () => {
    const logger = createTrackLogger('agent', { silent: true, minLevel: 'debug' });
    const fn = makeFn();
    const llm = mockCallerReturning(
      JSON.stringify([
        {
          bugType: 'logic',
          line: 13,
          severity: 'P1',
          confidence: 'high',
          oneLineDesc: 'something',
          rationale: 'reason here',
          codeSnippet: 'snip',
        },
      ]),
    );
    const { entries } = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\.llm-detect\./ },
      async () =>
        findBugsViaLLM({
          cwd: '/tmp',
          functions: [fn],
          criticConfig: fakeConfig,
          criticApiKey: 'sk-test',
          logger,
          callLLM: llm,
          concurrency: 1,
        }),
    );
    const events = entries.map((e) => e.event);
    expect(events).toContain('agent.llm-detect.start');
    expect(events).toContain('agent.llm-detect.fn.scan-start');
    expect(events).toContain('agent.llm-detect.fn.bugs-found');
    expect(events).toContain('agent.llm-detect.complete');
    const complete = entries.find((e) => e.event === 'agent.llm-detect.complete');
    expect((complete as any)?.totalBugs).toBe(1);
    expect((complete as any)?.byCategory).toEqual({ logic: 1 });
  });

  it('low-confidence bug dropped by default (medium threshold)', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const fn = makeFn();
    const llm = mockCallerReturning(
      JSON.stringify([
        {
          bugType: 'logic',
          line: 13,
          severity: 'P2',
          confidence: 'low',
          oneLineDesc: 'maybe',
          rationale: 'unsure',
          codeSnippet: 'snip',
        },
      ]),
    );
    const out = await findBugsViaLLM({
      cwd: '/tmp',
      functions: [fn],
      criticConfig: fakeConfig,
      criticApiKey: 'sk-test',
      logger,
      callLLM: llm,
      concurrency: 1,
    });
    expect(out).toEqual([]);
  });

  it('low-confidence kept when minConfidence: low', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const fn = makeFn();
    const llm = mockCallerReturning(
      JSON.stringify([
        {
          bugType: 'logic',
          line: 13,
          severity: 'P3',
          confidence: 'low',
          oneLineDesc: 'maybe-bug',
          rationale: 'unsure but worth checking',
          codeSnippet: 'snip',
        },
      ]),
    );
    const out = await findBugsViaLLM({
      cwd: '/tmp',
      functions: [fn],
      criticConfig: fakeConfig,
      criticApiKey: 'sk-test',
      logger,
      callLLM: llm,
      concurrency: 1,
      minConfidence: 'low',
    });
    expect(out).toHaveLength(1);
  });

  it('maxBugsPerFunction caps bug count per function', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const fn = makeFn();
    const bugs = [];
    for (let i = 0; i < 10; i++) {
      bugs.push({
        bugType: 'logic',
        line: 13,
        severity: 'P2',
        confidence: 'high',
        oneLineDesc: `bug ${i}`,
        rationale: 'reason',
        codeSnippet: 'snip',
      });
    }
    const llm = mockCallerReturning(JSON.stringify(bugs));
    const out = await findBugsViaLLM({
      cwd: '/tmp',
      functions: [fn],
      criticConfig: fakeConfig,
      criticApiKey: 'sk-test',
      logger,
      callLLM: llm,
      concurrency: 1,
      maxBugsPerFunction: 3,
    });
    expect(out).toHaveLength(3);
  });

  it('handles markdown-fenced JSON output', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const fn = makeFn();
    const raw =
      '```json\n' +
      JSON.stringify([
        {
          bugType: 'security',
          line: 12,
          severity: 'P1',
          confidence: 'high',
          oneLineDesc: 'sql concat',
          rationale: 'string-concatenated query.',
          codeSnippet: 'db.query("..." + x)',
        },
      ]) +
      '\n```';
    const llm = mockCallerReturning(raw);
    const out = await findBugsViaLLM({
      cwd: '/tmp',
      functions: [fn],
      criticConfig: fakeConfig,
      criticApiKey: 'sk-test',
      logger,
      callLLM: llm,
      concurrency: 1,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.bugType).toBe('security');
  });

  it('handles <think>…</think> reasoning blocks', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const fn = makeFn();
    const raw =
      '<think>Let me reason about this...</think>\n' +
      JSON.stringify([
        {
          bugType: 'type-safety',
          line: 11,
          severity: 'P2',
          confidence: 'high',
          oneLineDesc: 'unchecked optional access',
          rationale: 'user could be undefined.',
          codeSnippet: 'user.password',
        },
      ]);
    const llm = mockCallerReturning(raw);
    const out = await findBugsViaLLM({
      cwd: '/tmp',
      functions: [fn],
      criticConfig: fakeConfig,
      criticApiKey: 'sk-test',
      logger,
      callLLM: llm,
      concurrency: 1,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.bugType).toBe('type-safety');
  });

  it('parseBugsFromRaw returns null on totally malformed input', () => {
    const logger = createTrackLogger('agent', { silent: true });
    const r = parseBugsFromRaw('I refuse', logger, 'fn-id');
    expect(r).toBeNull();
  });

  it('parseBugsFromRaw wraps single object into array', () => {
    const logger = createTrackLogger('agent', { silent: true });
    const single = JSON.stringify({
      bugType: 'logic',
      line: 1,
      severity: 'P1',
      confidence: 'high',
      oneLineDesc: 'x',
      rationale: 'y',
      codeSnippet: 'z',
    });
    const r = parseBugsFromRaw(single, logger, 'fn-id');
    expect(Array.isArray(r)).toBe(true);
    expect(r).toHaveLength(1);
  });

  it('drops bug with missing oneLineDesc', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const fn = makeFn();
    const llm = mockCallerReturning(
      JSON.stringify([
        {
          bugType: 'logic',
          line: 13,
          severity: 'P1',
          confidence: 'high',
          // oneLineDesc missing
          rationale: 'reason',
          codeSnippet: 'snip',
        },
      ]),
    );
    const out = await findBugsViaLLM({
      cwd: '/tmp',
      functions: [fn],
      criticConfig: fakeConfig,
      criticApiKey: 'sk-test',
      logger,
      callLLM: llm,
      concurrency: 1,
    });
    expect(out).toEqual([]);
  });

  it('mockCallerThrowing never bubbles out of batch', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const fn = makeFn();
    const llm = mockCallerThrowing('network reset');
    const out = await findBugsViaLLM({
      cwd: '/tmp',
      functions: [fn],
      criticConfig: fakeConfig,
      criticApiKey: 'sk-test',
      logger,
      callLLM: llm,
      concurrency: 1,
    });
    expect(out).toEqual([]);
  });
});
