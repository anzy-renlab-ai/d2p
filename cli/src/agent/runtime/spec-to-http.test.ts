/**
 * Tests for spec-to-http.
 *
 * Heuristic tests are hermetic. LLM tests inject a fake LlmCaller.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { specToHttpTest, type SpecLlmCaller } from './spec-to-http.js';
import type { TestCaseSpec } from '../types.js';
import type { EngineConfig } from '../../stubs.js';
import {
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from '../../log-types.js';

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

function spec(overrides: Partial<TestCaseSpec>): TestCaseSpec {
  return {
    id: 'spec-1',
    name: 'baseline',
    category: 'edge-case',
    scope: {
      type: 'endpoint',
      target: 'POST /api/login',
      file: 'server.js',
      line: 1,
    },
    given: 'no email in body',
    when: 'POST /api/login',
    then: 'returns 400',
    reasoning: 'why',
    ...overrides,
  };
}

const fakeCfg: EngineConfig = {
  kind: 'openai-compat',
  modelId: 'm',
  releaseDate: '2026-01-01',
  baseUrl: 'https://x',
};

describe('specToHttpTest — heuristic', () => {
  it('parses METHOD /path target', async () => {
    const r = await specToHttpTest(spec({}), {
      criticConfig: null,
      criticApiKey: null,
    });
    expect(r).not.toBeNull();
    expect(r!.method).toBe('POST');
    expect(r!.path).toBe('/api/login');
    expect(r!.expectedStatus).toBe(400);
  });

  it('extracts status from then', async () => {
    const r = await specToHttpTest(
      spec({ then: 'should respond with 201 Created', target: undefined } as any),
      { criticConfig: null, criticApiKey: null },
    );
    // target still POST /api/login; status from then
    expect(r!.expectedStatus).toBe(201);
  });

  it('defaults method to GET when target is bare /path', async () => {
    const r = await specToHttpTest(
      spec({ scope: { type: 'endpoint', target: '/healthz', file: 's.js', line: 1 } }),
      { criticConfig: null, criticApiKey: null },
    );
    expect(r!.method).toBe('GET');
    expect(r!.path).toBe('/healthz');
  });

  it('returns null when scope is function and no LLM', async () => {
    const r = await specToHttpTest(
      spec({
        scope: { type: 'function', target: 'fn:hashPassword', file: 'h.js', line: 5 },
      }),
      { criticConfig: null, criticApiKey: null },
    );
    expect(r).toBeNull();
  });

  it('returns null when endpoint target is garbage and no LLM', async () => {
    const r = await specToHttpTest(
      spec({ scope: { type: 'endpoint', target: 'something weird', file: 's.js', line: 1 } }),
      { criticConfig: null, criticApiKey: null },
    );
    expect(r).toBeNull();
  });
});

describe('specToHttpTest — LLM fallback', () => {
  it('uses LLM when heuristic returns null', async () => {
    const llm: SpecLlmCaller = async () => ({
      rawText: JSON.stringify({
        method: 'POST',
        path: '/api/foo',
        expectedStatus: 200,
      }),
      durationMs: 5,
    });
    const r = await specToHttpTest(
      spec({ scope: { type: 'function', target: 'fn:x', file: 'a.js', line: 1 } }),
      { criticConfig: fakeCfg, criticApiKey: 'k', callLLM: llm },
    );
    expect(r).not.toBeNull();
    expect(r!.method).toBe('POST');
    expect(r!.path).toBe('/api/foo');
    expect(r!.expectedStatus).toBe(200);
  });

  it('respects explicit null from LLM', async () => {
    const llm: SpecLlmCaller = async () => ({ rawText: 'null', durationMs: 3 });
    const r = await specToHttpTest(
      spec({ scope: { type: 'function', target: 'fn:x', file: 'a.js', line: 1 } }),
      { criticConfig: fakeCfg, criticApiKey: 'k', callLLM: llm },
    );
    expect(r).toBeNull();
  });

  it('returns null on LLM error', async () => {
    const llm: SpecLlmCaller = async () => {
      throw new Error('boom');
    };
    const r = await specToHttpTest(
      spec({ scope: { type: 'function', target: 'fn:x', file: 'a.js', line: 1 } }),
      { criticConfig: fakeCfg, criticApiKey: 'k', callLLM: llm },
    );
    expect(r).toBeNull();
  });
});
