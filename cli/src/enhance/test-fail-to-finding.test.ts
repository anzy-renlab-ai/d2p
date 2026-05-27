/**
 * Tests for enhance/test-fail-to-finding (Phase 11.3).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { testFailsToFindings, readTestResultsFile } from './test-fail-to-finding.js';
import type { TestCaseResult, TestCaseSpec, TestCaseCategory } from '../agent/types.js';

function mkSpec(o: Partial<TestCaseSpec> = {}): TestCaseSpec {
  return {
    id: 'spec-1',
    name: 'IDOR exposes data',
    category: 'security',
    scope: { type: 'endpoint', target: 'GET /api/x', file: 'app/x/route.ts', line: 12 },
    given: 'auth user',
    when: 'requests other user data',
    then: 'returns 403',
    reasoning: 'authz',
    ...o,
  };
}

function mkResult(o: Partial<TestCaseResult> = {}): TestCaseResult {
  return {
    spec: mkSpec(),
    status: 'fail',
    verdictReason: 'no auth check found',
    evidence: {
      file: 'app/x/route.ts',
      line: 15,
      snippet: 'const data = await db.find(id)',
      expectedBehavior: 'check user owns row',
      actualBehavior: 'returns any row by id',
    },
    criticFamily: 'openai-gpt',
    durationMs: 100,
    ...o,
  };
}

describe('testFailsToFindings', () => {
  it('security category → P1', () => {
    const f = testFailsToFindings({ results: [mkResult({ spec: mkSpec({ category: 'security' }) })] });
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe('P1');
  });

  it('auth category → P1', () => {
    const f = testFailsToFindings({ results: [mkResult({ spec: mkSpec({ category: 'auth' }) })] });
    expect(f[0]!.severity).toBe('P1');
  });

  it('validation category → P2', () => {
    const f = testFailsToFindings({ results: [mkResult({ spec: mkSpec({ category: 'validation' }) })] });
    expect(f[0]!.severity).toBe('P2');
  });

  it('error-handling category → P2', () => {
    const f = testFailsToFindings({ results: [mkResult({ spec: mkSpec({ category: 'error-handling' }) })] });
    expect(f[0]!.severity).toBe('P2');
  });

  it('happy-path category → P3', () => {
    const f = testFailsToFindings({ results: [mkResult({ spec: mkSpec({ category: 'happy-path' }) })] });
    expect(f[0]!.severity).toBe('P3');
  });

  it('edge-case category → P3', () => {
    const f = testFailsToFindings({ results: [mkResult({ spec: mkSpec({ category: 'edge-case' }) })] });
    expect(f[0]!.severity).toBe('P3');
  });

  it('minSeverity=P1 filters out P2/P3', () => {
    const results = [
      mkResult({ spec: mkSpec({ id: 'p1', category: 'security' }) }),
      mkResult({ spec: mkSpec({ id: 'p2', category: 'validation' }) }),
      mkResult({ spec: mkSpec({ id: 'p3', category: 'happy-path' }) }),
    ];
    const f = testFailsToFindings({ results, minSeverity: 'P1' });
    expect(f).toHaveLength(1);
    expect(f[0]!.id).toBe('p1');
  });

  it('minSeverity=P2 keeps P1+P2, drops P3', () => {
    const results = [
      mkResult({ spec: mkSpec({ id: 'p1', category: 'security' }) }),
      mkResult({ spec: mkSpec({ id: 'p2', category: 'validation' }) }),
      mkResult({ spec: mkSpec({ id: 'p3', category: 'happy-path' }) }),
    ];
    const f = testFailsToFindings({ results, minSeverity: 'P2' });
    expect(f).toHaveLength(2);
  });

  it('empty input → empty output', () => {
    expect(testFailsToFindings({ results: [] })).toEqual([]);
  });

  it('status=pass filtered out', () => {
    const f = testFailsToFindings({ results: [mkResult({ status: 'pass' })] });
    expect(f).toEqual([]);
  });

  it('status=inconclusive filtered out', () => {
    const f = testFailsToFindings({ results: [mkResult({ status: 'inconclusive' })] });
    expect(f).toEqual([]);
  });

  it('status=skipped filtered out', () => {
    const f = testFailsToFindings({ results: [mkResult({ status: 'skipped' })] });
    expect(f).toEqual([]);
  });

  it('preserves traceability: finding.id == spec.id', () => {
    const f = testFailsToFindings({ results: [mkResult({ spec: mkSpec({ id: 'get-api-graveyard-3' }) })] });
    expect(f[0]!.id).toBe('get-api-graveyard-3');
  });

  it('category prefix is test-case-fail-<original>', () => {
    const f = testFailsToFindings({ results: [mkResult({ spec: mkSpec({ category: 'security' }) })] });
    expect(f[0]!.category).toBe('test-case-fail-security');
  });

  it('message combines spec.name + verdictReason', () => {
    const f = testFailsToFindings({
      results: [mkResult({
        spec: mkSpec({ name: 'IDOR test' }),
        verdictReason: 'no auth check',
      })],
    });
    expect(f[0]!.message).toContain('IDOR test');
    expect(f[0]!.message).toContain('no auth check');
  });

  it('evidence flattened: file/line/snippet/expectedBehavior/actualBehavior', () => {
    const f = testFailsToFindings({ results: [mkResult({
      evidence: {
        file: 'a.ts',
        line: 99,
        snippet: 'code here',
        expectedBehavior: 'EXPECTED',
        actualBehavior: 'ACTUAL',
      },
    })] });
    expect(f[0]!.file).toBe('a.ts');
    expect(f[0]!.line).toBe(99);
    expect(f[0]!.snippet).toBe('code here');
    expect(f[0]!.expectedBehavior).toBe('EXPECTED');
    expect(f[0]!.actualBehavior).toBe('ACTUAL');
  });

  it('falls back to spec.scope.file/line when evidence missing', () => {
    const f = testFailsToFindings({ results: [mkResult({
      spec: mkSpec({ scope: { type: 'endpoint', target: 'GET /', file: 'spec-file.ts', line: 42 } }),
      evidence: {},
    })] });
    expect(f[0]!.file).toBe('spec-file.ts');
    expect(f[0]!.line).toBe(42);
  });

  it('falls back to spec.then for expectedBehavior when evidence missing', () => {
    const f = testFailsToFindings({ results: [mkResult({
      spec: mkSpec({ then: 'returns 403' }),
      evidence: { file: 'a.ts', line: 1 },
    })] });
    expect(f[0]!.expectedBehavior).toBe('returns 403');
  });

  it('sorts by severity desc, then file, then line', () => {
    const noEvidence = { file: undefined, line: undefined };
    const results = [
      mkResult({ spec: mkSpec({ id: 'a', category: 'happy-path', scope: { type: 'endpoint', target: 'x', file: 'z.ts', line: 1 } }), evidence: noEvidence }),
      mkResult({ spec: mkSpec({ id: 'b', category: 'security', scope: { type: 'endpoint', target: 'x', file: 'b.ts', line: 5 } }), evidence: noEvidence }),
      mkResult({ spec: mkSpec({ id: 'c', category: 'security', scope: { type: 'endpoint', target: 'x', file: 'a.ts', line: 5 } }), evidence: noEvidence }),
      mkResult({ spec: mkSpec({ id: 'd', category: 'validation', scope: { type: 'endpoint', target: 'x', file: 'm.ts', line: 1 } }), evidence: noEvidence }),
    ];
    const f = testFailsToFindings({ results });
    expect(f.map((x) => x.id)).toEqual(['c', 'b', 'd', 'a']);
  });
});

describe('readTestResultsFile', () => {
  function tmp(): { dir: string; cleanup: () => void } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf2f-'));
    return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
  }

  it('returns [] when file missing', () => {
    const t = tmp();
    try {
      expect(readTestResultsFile(t.dir)).toEqual([]);
    } finally {
      t.cleanup();
    }
  });

  it('parses valid JSON array', () => {
    const t = tmp();
    try {
      fs.mkdirSync(path.join(t.dir, '.zerou'), { recursive: true });
      fs.writeFileSync(
        path.join(t.dir, '.zerou', 'test-results.json'),
        JSON.stringify([mkResult()]),
        'utf8',
      );
      const r = readTestResultsFile(t.dir);
      expect(r).toHaveLength(1);
      expect(r[0]!.status).toBe('fail');
    } finally {
      t.cleanup();
    }
  });

  it('returns [] on malformed JSON', () => {
    const t = tmp();
    try {
      fs.mkdirSync(path.join(t.dir, '.zerou'), { recursive: true });
      fs.writeFileSync(path.join(t.dir, '.zerou', 'test-results.json'), 'not json', 'utf8');
      expect(readTestResultsFile(t.dir)).toEqual([]);
    } finally {
      t.cleanup();
    }
  });

  it('filters out entries missing required fields', () => {
    const t = tmp();
    try {
      fs.mkdirSync(path.join(t.dir, '.zerou'), { recursive: true });
      const bag = [
        mkResult(),
        { not: 'a result' },
        { spec: { id: 'no-status' } },
      ];
      fs.writeFileSync(
        path.join(t.dir, '.zerou', 'test-results.json'),
        JSON.stringify(bag),
        'utf8',
      );
      const r = readTestResultsFile(t.dir);
      expect(r).toHaveLength(1);
    } finally {
      t.cleanup();
    }
  });
});

// Ensure TS type-narrowing for TestCaseCategory works in tests
const _typeCheck: TestCaseCategory[] = ['security', 'auth', 'validation', 'error-handling', 'edge-case', 'happy-path'];
expect; // keep tree-shake safe
void _typeCheck;
