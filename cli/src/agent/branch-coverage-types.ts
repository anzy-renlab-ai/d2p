/**
 * Phase 11.5 — Branch coverage report data shapes.
 *
 * The killer feature: cross-reference 4 independent signals per code branch:
 *   1. AST  — does the branch exist? (static analysis)
 *   2. SPEC — did any generated test spec mention this branch's outcome?
 *   3. JUDGE — did the LLM-judge's `evidence.snippet` quote this branch?
 *   4. RUN  — did vitest c8/istanbul show this line / branch executed?
 *
 * If a spec CLAIMS to test branch X but RUN shows 0 hits + JUDGE quoted nothing
 * → self-deceiving test. ZeroU surfaces these explicitly.
 *
 * Authority: docs/plans/2026-05-27-phase-10-enhance.md + this session's
 * branch-tree decision.
 */
import type { TestCaseStatus } from './types.js';

/** One decision branch in a function: an if/else arm, switch case, try/catch arm. */
export interface BranchNode {
  /** Stable id per function. e.g. 'if-line9-true' / 'switch-case-default' / 'catch-line22'. */
  id: string;
  /** Human-readable. e.g. '!email TRUE → 400' / 'db error / catch'. */
  label: string;
  /** Source line range (1-based). */
  lineStart: number;
  lineEnd: number;
  /** Branch kind. */
  kind: 'entry' | 'if-true' | 'if-false' | 'switch-case' | 'switch-default' | 'try-body' | 'catch' | 'finally' | 'ternary-true' | 'ternary-false' | 'loop-body' | 'short-circuit';
  /** Nested branches inside this one (e.g. nested ifs). */
  children: BranchNode[];

  // ── 4 coverage signals ─────────────────────────────────────────────
  /** AST always 'present' — included as marker; presence == exists. */
  ast: { present: true };
  /** Specs whose `then` text matched this branch's label (heuristic). */
  specMatches: SpecMatch[];
  /** Did the LLM-judge cite a snippet inside this branch's line range? */
  judgeEvidence: JudgeEvidence[];
  /** Did vitest c8 register hits for ANY line in this branch's range? */
  runtimeCoverage: RuntimeCoverage;
  /** Composite verdict derived from the 4 signals. */
  verdict: BranchVerdict;
}

export interface SpecMatch {
  specId: string;
  specName: string;
  matchedTokens: string[];     // e.g. ['401', 'password mismatch']
}

export interface JudgeEvidence {
  specId: string;
  status: TestCaseStatus;
  snippet: string;             // verbatim from TestCaseResult.evidence.snippet
}

export interface RuntimeCoverage {
  linesTotal: number;
  linesCovered: number;
  branchHit: boolean | null;   // null = no coverage data (vitest didn't run, or no branch info)
}

export type BranchVerdict =
  | 'covered'                  // all 4: ast + spec + judge + run
  | 'judge-only'               // ast + spec + judge but RUN says no hit  ← self-deceiving (LLM lied)
  | 'spec-only'                // ast + spec but no judge + no run         ← LLM-judge skipped this
  | 'run-only'                 // ast + run but no spec mentioned          ← tests covered by accident
  | 'untested'                 // ast only — no spec, no judge, no run     ← genuinely missing
  | 'unknown';                 // missing some data (e.g., no test-results.json yet)

/** All branches for one function in one file. */
export interface FunctionCoverage {
  /** Unique within report. `${file}:${name}@${line}` */
  id: string;
  /** POSIX relative path. */
  file: string;
  /** Function name (or 'POST' / 'GET' for Next.js verbs). */
  name: string;
  /** Declaration line. */
  line: number;
  /** Total AST branches (depth-flattened). */
  branchCount: number;
  /** How many of branchCount have verdict='covered'. */
  coveredCount: number;
  /** Branches with verdict='judge-only' — the SELF-DECEIVING TESTS. */
  selfDeceivingCount: number;
  /** Branches with verdict='untested'. */
  untestedCount: number;
  /** Tree of branches. */
  root: BranchNode;
  /** Specs that targeted this function (by spec.scope.target). */
  associatedSpecs: AssociatedSpec[];
}

export interface AssociatedSpec {
  specId: string;
  specName: string;
  status: TestCaseStatus;
  category: string;
}

/** Top-level report written to .zerou/branch-coverage.json by audit. */
export interface BranchCoverageReport {
  generatedAt: string;         // ISO timestamp
  cwd: string;                 // absolute path of audited project
  functions: FunctionCoverage[];
  summary: {
    functionsAnalyzed: number;
    branchesTotal: number;
    branchesCovered: number;
    selfDeceivingTotal: number;
    untestedTotal: number;
    /** Functions that have any self-deceiving branch — prime "audit me" candidates. */
    functionsWithSelfDeception: number;
  };
  /** Which signals were actually available. */
  availability: {
    ast: boolean;
    spec: boolean;
    judge: boolean;
    runtime: boolean;          // c8/istanbul data present
  };
}

/** Opts for the collector. */
export interface CollectorOpts {
  cwd: string;
  /** Path to .zerou/test-results.json. Optional — collector gracefully falls back. */
  testResultsPath?: string;
  /** Path to coverage final JSON. Optional. */
  coverageFinalPath?: string;
  /** Max source files to walk. Default 100. */
  maxFiles?: number;
  /** Max branches per function. Default 50 (skip mega-functions). */
  maxBranchesPerFunction?: number;
  logger: import('../log-types.js').TrackLogger;
}
