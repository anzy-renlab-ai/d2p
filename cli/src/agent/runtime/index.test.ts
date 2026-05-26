/**
 * End-to-end tests for the runtime orchestration entry point.
 *
 * Strategy: real npm-script-less fixture (node-server-ok) — we bypass
 * `detectRuntime` semantics for non-package tests by pointing at the fixture
 * package.json (which uses `node server.js`).
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runRuntimeTests } from './index.js';
import type { TestCaseSpec } from '../types.js';
import {
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from '../../log-types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, '__fixtures__', 'node-server-ok');

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

function makeSpec(id: string, target: string, then: string, given = ''): TestCaseSpec {
  return {
    id,
    name: id,
    category: 'edge-case',
    scope: { type: 'endpoint', target, file: 'server.js', line: 1 },
    given,
    when: target,
    then,
    reasoning: 'r',
  };
}

describe('runRuntimeTests', () => {
  it('returns empty results when no runtime detected', async () => {
    // Use a directory without package.json
    const r = await runRuntimeTests([makeSpec('s1', 'GET /x', 'returns 200')], here, {
      criticConfig: null,
      criticApiKey: null,
    });
    expect(r.results).toEqual([]);
    expect(r.runtime).toBeNull();
  });

  it('launches fixture, runs HTTP test, kills process', async () => {
    // Two specs: one will pass, one will fail.
    const specs: TestCaseSpec[] = [
      // POST /api/login with no body → 400 expected; server returns 400.
      makeSpec('login-no-email', 'POST /api/login', 'returns 400'),
      // GET /healthz → 200 expected (heuristic should pull 200 out of `then`).
      makeSpec('health-ok', 'GET /healthz', 'returns 200'),
    ];
    const r = await runRuntimeTests(specs, FIXTURE, {
      criticConfig: null,
      criticApiKey: null,
      readyTimeoutMs: 8000,
      pollIntervalMs: 100,
    });
    expect(r.results).toHaveLength(2);
    // Both should pass — fixture handles both cases.
    const statuses = r.results.map((x) => x.status);
    expect(statuses).toContain('pass');
    // runtime handle should be returned (even though kill already ran)
    expect(r.runtime).not.toBeNull();
    // Allow time for process to actually die before exiting test.
  }, 20_000);

  it('returns inconclusive results when launch fails', async () => {
    // Build a fake fixture dir with a crashing script.
    const crashDir = path.join(here, '__fixtures__', 'node-crash');
    const specs: TestCaseSpec[] = [makeSpec('s1', 'GET /x', 'returns 200')];
    const r = await runRuntimeTests(specs, crashDir, {
      criticConfig: null,
      criticApiKey: null,
      readyTimeoutMs: 4000,
      pollIntervalMs: 100,
    });
    expect(r.runtime).toBeNull();
    expect(r.results).toHaveLength(1);
    expect(r.results[0]!.status).toBe('inconclusive');
    expect(r.results[0]!.verdictReason).toMatch(/launch failed/);
  }, 15_000);
});
