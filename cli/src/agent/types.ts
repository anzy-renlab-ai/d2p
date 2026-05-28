/**
 * Agent shared types (Phase 4).
 *
 * Surface authority: `docs/plans/2026-05-26-phase-4-agent-orchestrator.md` §"agent/types.ts".
 *
 * Track A owns this file. Track B reads it via stub during parallel dispatch
 * and the lead integrates the real one during Round 2.
 */

/** The 12 canonical audit categories the agent reasons about. */
export type AuditCategory =
  | 'secrets'
  | 'auth'
  | 'authz'
  | 'db'
  | 'security'
  | 'observability'
  | 'error-handling'
  | 'tests'
  | 'perf'
  | 'llm-cost'
  | 'gdpr'
  | 'deploy-incident';

/** All 12 categories as a static array (for iteration / mapping). */
export const ALL_AUDIT_CATEGORIES: readonly AuditCategory[] = [
  'secrets',
  'auth',
  'authz',
  'db',
  'security',
  'observability',
  'error-handling',
  'tests',
  'perf',
  'llm-cost',
  'gdpr',
  'deploy-incident',
] as const;

/**
 * Inferred shape of the project under audit. Produced by `detectProject`.
 *
 * Evidence is a free-form bag of "what we read to reach this conclusion" so
 * the log trail (and future debugging) can show the raw inputs.
 */
export interface ProjectProfile {
  framework: string;          // 'next.js' | 'vite' | 'express' | 'unknown' | ...
  backend: string | null;     // 'supabase' | 'firebase' | 'custom-express' | null
  language: string[];         // ['typescript', 'sql', ...]
  hasGit: boolean;
  hasTests: boolean;          // detected via package.json scripts or tests dir
  hasEnvFile: boolean;        // .env or .env.example present
  packageMgr: 'npm' | 'pnpm' | 'yarn' | null;
  evidence: Record<string, string>;
}

/** One row in the agent's "what to test" checklist. */
export interface ChecklistItem {
  category: AuditCategory;
  priority: 'high' | 'medium' | 'low' | 'skip';
  reasoning: string;
  presetIds: string[];        // existing preset ids covering this category
}

/** A single agent decision point — recorded for replay / debugging. */
export interface AgentDecision {
  ts: number;
  step: string;               // e.g. 'project-detection' | 'checklist-build'
  decision: string;           // e.g. 'use-preset' | 'skip' | 'llm-judgment'
  reasoning: string;
  evidence?: unknown;
}

// ── Phase 5: Test Case types (Track E) ──────────────────────────────────────

/** Status of one executed test case. */
export type TestCaseStatus = 'pass' | 'fail' | 'inconclusive' | 'skipped';

/** Categories a generated test case falls into. */
export type TestCaseCategory =
  | 'happy-path'
  | 'edge-case'
  | 'security'
  | 'error-handling'
  | 'auth'
  | 'validation'
  | 'logic-correctness';

/** Scope of what the test targets. */
export interface TestCaseScope {
  type: 'endpoint' | 'function' | 'flow';
  target: string;             // 'POST /api/login' / 'fn:hashPassword' / 'flow:signup'
  file: string;               // source file path (relative to cwd)
  line: number;               // 1-based
}

/**
 * One generated test specification. Produced by `generateTestCases` from
 * `test-case-generator.ts`; consumed by `runTestCase` from `test-spec-runner.ts`.
 */
export interface TestCaseSpec {
  id: string;                          // <target-id>-<sequential>, e.g. 'login-1'
  name: string;                        // human-readable, 5-10 words
  category: TestCaseCategory;
  scope: TestCaseScope;
  given: string;                       // preconditions
  when: string;                        // action to test
  then: string;                        // expected outcome
  reasoning: string;                   // why this test matters
}

/** Result of executing one test case. */
export interface TestCaseResult {
  spec: TestCaseSpec;
  status: TestCaseStatus;
  verdictReason: string;               // LLM explanation
  evidence: {
    file?: string;
    line?: number;
    snippet?: string;                  // relevant code snippet
    expectedBehavior?: string;
    actualBehavior?: string;
  };
  criticFamily: string | null;
  durationMs: number;
}

/** Aggregate of one batch of test cases. */
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
