/**
 * STUB: real types from Track E during integration.
 *
 * Track F (test-spec-runner + test-result-logger) is implemented in parallel
 * with Track E (test-case-generator). Track E will add the canonical
 * `TestCaseSpec` / `TestCaseResult` / `TestSummary` types to
 * `cli/src/agent/types.ts`. To avoid a merge conflict, Track F imports the
 * same names from this throwaway stub file. The lead deletes this file
 * during integration and rewrites the imports in test-spec-runner.ts /
 * test-result-logger.ts to point at `agent/types.ts`.
 *
 * Keep shapes byte-identical with the spec doc:
 *   docs/plans/2026-05-26-phase-5-test-case-agent.md
 */

export type TestCaseStatus = 'pass' | 'fail' | 'inconclusive' | 'skipped';

export interface TestCaseSpec {
  id: string;
  name: string;
  category: 'happy-path' | 'edge-case' | 'security' | 'error-handling' | 'auth' | 'validation';
  scope: {
    type: 'endpoint' | 'function' | 'flow';
    target: string;
    file: string;
    line: number;
  };
  given: string;
  when: string;
  then: string;
  reasoning: string;
}

export interface TestCaseResult {
  spec: TestCaseSpec;
  status: TestCaseStatus;
  verdictReason: string;
  evidence: {
    file?: string;
    line?: number;
    snippet?: string;
    expectedBehavior?: string;
    actualBehavior?: string;
  };
  criticFamily: string | null;
  durationMs: number;
}

export interface TestSummary {
  total: number;
  pass: number;
  fail: number;
  inconclusive: number;
  skipped: number;
  byCategory: Record<
    string,
    { pass: number; fail: number; inconclusive: number; skipped: number }
  >;
}
