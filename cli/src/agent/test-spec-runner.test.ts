/**
 * Tests for agent/test-spec-runner.
 *
 * Strategy: inject a mock LlmCaller so tests are hermetic. The fallback path
 * (no critic key) does NOT call the LLM; it short-circuits to 'skipped'.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  runTestCase,
  runTestCaseBatch,
  type LlmCaller,
} from './test-spec-runner.js';
import {
  createTrackLogger,
  captureLogsFor,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from '../log-types.js';
import type { TestCaseSpec } from './test-types-stub.js';
import type { EngineConfig } from '../stubs.js';

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

function makeSpec(overrides: Partial<TestCaseSpec> = {}): TestCaseSpec {
  return {
    id: 'spec-1',
    name: 'baseline test',
    category: 'happy-path',
    scope: {
      type: 'function',
      target: 'fn:handleLogin',
      file: '__nonexistent__.ts',
      line: 1,
    },
    given: 'a baseline given',
    when: 'a baseline when',
    then: 'a baseline then',
    reasoning: 'because',
    ...overrides,
  };
}

const fakeConfig: EngineConfig = {
  kind: 'openai-compat',
  modelId: 'fake-model',
  releaseDate: '2026-01-01',
  baseUrl: 'https://example.com/v1',
  apiKey: 'unused-here',
};

function withTempFile(content: string): { file: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsr-'));
  const file = path.join(dir, 'src.ts');
  fs.writeFileSync(file, content, 'utf8');
  return {
    file,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

function mockCallerReturning(raw: string): LlmCaller {
  return async () => ({ rawText: raw, durationMs: 5 });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('test-spec-runner.runTestCase', () => {
  it('returns pass when LLM verdict is pass', async () => {
    const { file, cleanup } = withTempFile(
      [
        'export function handleLogin(email: string) {',
        "  if (!email) throw new Error('email required');",
        "  return { token: 'jwt' };",
        '}',
      ].join('\n'),
    );
    try {
      const logger = createTrackLogger('agent', { silent: true });
      const llm = mockCallerReturning(
        JSON.stringify({
          status: 'pass',
          verdictReason: 'guard at line 2 returns when email missing',
          evidence: {
            file,
            line: 2,
            snippet: "if (!email) throw new Error('email required');",
            expectedBehavior: 'throws when email missing',
            actualBehavior: 'throws when email missing',
          },
        }),
      );
      const result = await runTestCase({
        spec: makeSpec({ scope: { type: 'function', target: 'fn:handleLogin', file, line: 2 } }),
        cwd: path.dirname(file),
        logger,
        criticConfig: fakeConfig,
        criticApiKey: 'sk-test',
        callLLM: llm,
      });
      expect(result.status).toBe('pass');
      expect(result.verdictReason).toContain('guard at line 2');
      expect(result.evidence.line).toBe(2);
      expect(result.criticFamily).toBeTruthy();
    } finally {
      cleanup();
    }
  });

  it('returns fail with evidence filled when LLM verdict is fail', async () => {
    const { file, cleanup } = withTempFile(
      [
        'export function handleLogin(email: string, password: string) {',
        '  // BUG: plaintext compare',
        '  if (user.password !== password) throw new Error("invalid");',
        '}',
      ].join('\n'),
    );
    try {
      const logger = createTrackLogger('agent', { silent: true });
      const llm = mockCallerReturning(
        JSON.stringify({
          status: 'fail',
          verdictReason: 'plaintext password comparison; should use bcrypt.compare',
          evidence: {
            file,
            line: 3,
            snippet: 'user.password !== password',
            expectedBehavior: 'use bcrypt.compare',
            actualBehavior: 'strict-equals plaintext',
          },
        }),
      );
      const result = await runTestCase({
        spec: makeSpec({
          category: 'security',
          scope: { type: 'function', target: 'fn:handleLogin', file, line: 3 },
        }),
        cwd: path.dirname(file),
        logger,
        criticConfig: fakeConfig,
        criticApiKey: 'sk-test',
        callLLM: llm,
      });
      expect(result.status).toBe('fail');
      expect(result.evidence.actualBehavior).toContain('plaintext');
      expect(result.evidence.expectedBehavior).toContain('bcrypt');
    } finally {
      cleanup();
    }
  });

  it('returns inconclusive when LLM verdict is inconclusive', async () => {
    const { file, cleanup } = withTempFile('export function foo() { return bar(); }');
    try {
      const logger = createTrackLogger('agent', { silent: true });
      const llm = mockCallerReturning(
        JSON.stringify({
          status: 'inconclusive',
          verdictReason: 'depends on bar() definition not shown',
          evidence: { file, line: 1 },
        }),
      );
      const result = await runTestCase({
        spec: makeSpec({ scope: { type: 'function', target: 'fn:foo', file, line: 1 } }),
        cwd: path.dirname(file),
        logger,
        criticConfig: fakeConfig,
        criticApiKey: 'sk-test',
        callLLM: llm,
      });
      expect(result.status).toBe('inconclusive');
    } finally {
      cleanup();
    }
  });

  it('returns skipped when criticConfig is null (no LLM)', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const result = await runTestCase({
      spec: makeSpec(),
      cwd: '/tmp',
      logger,
      criticConfig: null,
      criticApiKey: null,
    });
    expect(result.status).toBe('skipped');
    expect(result.verdictReason).toMatch(/no critic key/);
    expect(result.criticFamily).toBeNull();
  });

  it('returns skipped when criticApiKey is null', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const result = await runTestCase({
      spec: makeSpec(),
      cwd: '/tmp',
      logger,
      criticConfig: fakeConfig,
      criticApiKey: null,
    });
    expect(result.status).toBe('skipped');
  });

  it('parses LLM response wrapped in <think> blocks', async () => {
    const { file, cleanup } = withTempFile('function foo() {}');
    try {
      const logger = createTrackLogger('agent', { silent: true });
      const llm = mockCallerReturning(
        '<think>I should analyze this carefully...</think>\n' +
          JSON.stringify({
            status: 'pass',
            verdictReason: 'function defined',
            evidence: { file, line: 1 },
          }),
      );
      const result = await runTestCase({
        spec: makeSpec({ scope: { type: 'function', target: 'fn:foo', file, line: 1 } }),
        cwd: path.dirname(file),
        logger,
        criticConfig: fakeConfig,
        criticApiKey: 'sk-test',
        callLLM: llm,
      });
      expect(result.status).toBe('pass');
    } finally {
      cleanup();
    }
  });

  it('parses LLM response wrapped in markdown code fences', async () => {
    const { file, cleanup } = withTempFile('function foo() {}');
    try {
      const logger = createTrackLogger('agent', { silent: true });
      const llm = mockCallerReturning(
        '```json\n' +
          JSON.stringify({
            status: 'fail',
            verdictReason: 'missing implementation',
            evidence: { file, line: 1 },
          }) +
          '\n```',
      );
      const result = await runTestCase({
        spec: makeSpec({ scope: { type: 'function', target: 'fn:foo', file, line: 1 } }),
        cwd: path.dirname(file),
        logger,
        criticConfig: fakeConfig,
        criticApiKey: 'sk-test',
        callLLM: llm,
      });
      expect(result.status).toBe('fail');
    } finally {
      cleanup();
    }
  });

  it('handles missing source file gracefully (still calls LLM)', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const llm = mockCallerReturning(
      JSON.stringify({
        status: 'inconclusive',
        verdictReason: 'source not visible',
        evidence: {},
      }),
    );
    const result = await runTestCase({
      spec: makeSpec({
        scope: {
          type: 'function',
          target: 'fn:nope',
          file: '/tmp/__definitely-does-not-exist__.ts',
          line: 5,
        },
      }),
      cwd: '/tmp',
      logger,
      criticConfig: fakeConfig,
      criticApiKey: 'sk-test',
      callLLM: llm,
    });
    expect(result.status).toBe('inconclusive');
  });

  it('returns inconclusive when LLM call throws', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const llm: LlmCaller = async () => {
      throw new Error('network down');
    };
    const result = await runTestCase({
      spec: makeSpec(),
      cwd: '/tmp',
      logger,
      criticConfig: fakeConfig,
      criticApiKey: 'sk-test',
      callLLM: llm,
    });
    expect(result.status).toBe('inconclusive');
    expect(result.verdictReason).toMatch(/llm call failed/);
  });

  it('returns inconclusive when JSON has invalid status enum', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const llm = mockCallerReturning(
      JSON.stringify({ status: 'maybe', verdictReason: 'unsure', evidence: {} }),
    );
    const result = await runTestCase({
      spec: makeSpec(),
      cwd: '/tmp',
      logger,
      criticConfig: fakeConfig,
      criticApiKey: 'sk-test',
      callLLM: llm,
    });
    expect(result.status).toBe('inconclusive');
    expect(result.verdictReason).toMatch(/parse failure/);
  });
});

describe('test-spec-runner.runTestCaseBatch', () => {
  it('aggregates results into a correct summary across 5 specs', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const specs: TestCaseSpec[] = [
      makeSpec({ id: 's1', category: 'happy-path' }),
      makeSpec({ id: 's2', category: 'security' }),
      makeSpec({ id: 's3', category: 'edge-case' }),
      makeSpec({ id: 's4', category: 'auth' }),
      makeSpec({ id: 's5', category: 'security' }),
    ];
    // Round-robin status assignments
    const statusForSpec: Record<string, 'pass' | 'fail' | 'inconclusive'> = {
      s1: 'pass',
      s2: 'fail',
      s3: 'inconclusive',
      s4: 'pass',
      s5: 'fail',
    };
    const llm: LlmCaller = async ({ userPrompt }) => {
      const match = userPrompt.match(/ID: (s\d)/);
      const id = match ? match[1] : 's1';
      const st = statusForSpec[id] ?? 'inconclusive';
      return {
        rawText: JSON.stringify({
          status: st,
          verdictReason: `verdict for ${id}`,
          evidence: {},
        }),
        durationMs: 1,
      };
    };
    const { results, summary } = await runTestCaseBatch(specs, {
      cwd: '/tmp',
      logger,
      criticConfig: fakeConfig,
      criticApiKey: 'sk-test',
      callLLM: llm,
    });
    expect(results).toHaveLength(5);
    expect(summary.total).toBe(5);
    expect(summary.pass).toBe(2);
    expect(summary.fail).toBe(2);
    expect(summary.inconclusive).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.byCategory.security).toEqual({
      pass: 0,
      fail: 2,
      inconclusive: 0,
      skipped: 0,
    });
    expect(summary.byCategory['happy-path']).toEqual({
      pass: 1,
      fail: 0,
      inconclusive: 0,
      skipped: 0,
    });
  });

  it('emits batch.start and batch.complete events with correct totals', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const specs = [makeSpec({ id: 's1' }), makeSpec({ id: 's2' })];
    const out = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\.test-run\./ },
      async () =>
        runTestCaseBatch(specs, {
          cwd: '/tmp',
          logger,
          criticConfig: null,
          criticApiKey: null,
        }),
    );
    const events = out.entries.map((e) => e.event);
    expect(events).toContain('agent.test-run.batch.start');
    expect(events).toContain('agent.test-run.batch.complete');
    // each spec emits start + skipped + complete; should not crash anything
    expect(out.result.summary.total).toBe(2);
    expect(out.result.summary.skipped).toBe(2);
  });
});
