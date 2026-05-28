/**
 * Phase 12 — ReviewBundle contract.
 *
 * Single source of truth for the JSON document `zerou review` UI consumes.
 * Worker B copies this file verbatim into `ui/src/types-zerou.ts`, so this
 * file MUST stay free of any imports from other `cli/src/*` modules. The few
 * dependent types (BranchCoverageReport, TestCaseCategory) are inlined here
 * as structural duplicates with the same shape — at build time both sides
 * agree because they describe the same JSON.
 *
 * If you need to change the shape: update this file, write a `version` bump
 * + a migration in review-data.ts, and notify Worker B.
 */

// ── Inlined structural duplicates (do NOT import from elsewhere) ────────────
//
// These mirror the cli-side types one-for-one so the UI side can take this
// file verbatim. JSON is the wire format; nothing in here is nominal-typed.

/** Mirrors `cli/src/agent/types.ts` TestCaseStatus. */
export type TestCaseStatus = 'pass' | 'fail' | 'inconclusive' | 'skipped';

/** Mirrors `cli/src/agent/branch-coverage-types.ts` BranchVerdict. */
export type BranchVerdict =
  | 'covered'
  | 'judge-only'
  | 'spec-only'
  | 'run-only'
  | 'untested'
  | 'unknown';

/** Mirrors `cli/src/agent/branch-coverage-types.ts` BranchNode (subset shape). */
export interface BranchNode {
  id: string;
  label: string;
  lineStart: number;
  lineEnd: number;
  kind:
    | 'entry'
    | 'if-true'
    | 'if-false'
    | 'switch-case'
    | 'switch-default'
    | 'try-body'
    | 'catch'
    | 'finally'
    | 'ternary-true'
    | 'ternary-false'
    | 'loop-body'
    | 'short-circuit';
  children: BranchNode[];
  ast: { present: true };
  specMatches: Array<{
    specId: string;
    specName: string;
    matchedTokens: string[];
  }>;
  judgeEvidence: Array<{
    specId: string;
    status: TestCaseStatus;
    snippet: string;
  }>;
  runtimeCoverage: {
    linesTotal: number;
    linesCovered: number;
    branchHit: boolean | null;
  };
  verdict: BranchVerdict;
}

export interface FunctionCoverage {
  id: string;
  file: string;
  name: string;
  line: number;
  branchCount: number;
  coveredCount: number;
  selfDeceivingCount: number;
  untestedCount: number;
  root: BranchNode;
  associatedSpecs: Array<{
    specId: string;
    specName: string;
    status: TestCaseStatus;
    category: string;
  }>;
}

export interface BranchCoverageReport {
  generatedAt: string;
  cwd: string;
  functions: FunctionCoverage[];
  summary: {
    functionsAnalyzed: number;
    branchesTotal: number;
    branchesCovered: number;
    selfDeceivingTotal: number;
    untestedTotal: number;
    functionsWithSelfDeception: number;
  };
  availability: {
    ast: boolean;
    spec: boolean;
    judge: boolean;
    runtime: boolean;
  };
}

// ── ReviewBundle contract (locked) ──────────────────────────────────────────

export type ReviewModuleId =
  | 'logging'
  | 'bug-patch'
  | 'health'
  | 'sentry'
  | 'env'
  | 'verify';

export type ReviewModuleStatus = 'ok' | 'skipped' | 'partial' | 'failed';

export interface ReviewModule {
  id: ReviewModuleId;
  label: string;
  status: ReviewModuleStatus;
  summary: string;
  filesTouched: number;
  details?: Record<string, unknown>;
}

export type ReviewFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ReviewFile {
  /** POSIX rel path. */
  path: string;
  /** Rename source (POSIX rel) when status === 'renamed'. */
  oldPath?: string;
  status: ReviewFileStatus;
  additions: number;
  deletions: number;
  /** Modules that touched this file (heuristic; may be empty). */
  modules: ReviewModuleId[];
  /** Full unified diff text (may already be capped by the producer). */
  unifiedDiff: string;
  /** When diff was elided (lockfile / binary / too big). */
  omittedReason?: string;
  /** Free-text reasoning lifted from the closest enhance decision-event. */
  reason?: string;
}

export type ReviewFindingSource = 'static' | 'test-fail';
export type ReviewSeverity = 'P1' | 'P2' | 'P3';
export type ReviewFindingStatus =
  | 'patched'
  | 'skipped'
  | 'failed'
  | 'unpatched';

export interface ReviewFinding {
  id: string;
  source: ReviewFindingSource;
  severity: ReviewSeverity;
  category: string;
  file: string;
  line: number;
  message: string;
  expectedBehavior?: string;
  actualBehavior?: string;
  snippet?: string;
  status: ReviewFindingStatus;
  /** Patcher reject reason / 'no-patch-yet' / verdict text. */
  reason?: string;
}

export type VerifyStepName = 'install' | 'tsc' | 'test' | 'build';

export interface ReviewVerifyStep {
  name: VerifyStepName;
  status: 'pass' | 'fail' | 'skipped';
  durationMs: number;
  failOutput?: string;
}

export interface ReviewVerify {
  ok: boolean;
  steps: ReviewVerifyStep[];
  brokenBy?: string;
}

export interface ReviewAudit {
  durationMs: number;
  hardeningFindings: number;
  testCases: {
    total: number;
    pass: number;
    fail: number;
    inconclusive: number;
    skipped: number;
  };
}

export interface ReviewBundle {
  version: 1;
  project: {
    name: string;
    cwd: string;
    branch: string;
    worktreePath: string;
    runTs: string;
  };
  generatedAt: string;
  durationMs: number;
  modules: ReviewModule[];
  files: ReviewFile[];
  findings: ReviewFinding[];
  branchCoverage: BranchCoverageReport | null;
  /** Phase 14 — branch-trace.jsonl events for the tree-as-log component. */
  branchTraceEvents?: BranchTraceEventLite[];
  verify: ReviewVerify;
  audit: ReviewAudit | null;
}

/** Subset of BranchTraceEvent we ship to the UI (skip heavy fields like hash chain). */
export interface BranchTraceEventLite {
  ts: string;
  trace_id: string;
  span_id?: string;
  event: 'branch.evidence';
  branch_id: string;
  branch_kind: string;
  branch_label: string;
  line_start: number;
  line_end: number;
  'code.function': string;
  'code.file.path': string;
  'code.line.number': number;
  signals: { ast: true; spec: boolean; judge: boolean; run: boolean | null };
  verdict: string;
  evidence?: { spec_ids?: string[]; runtime_hits?: number };
  seq: number;
}

/** Friendly labels for each module id (used by the UI + writer). */
export const MODULE_LABELS: Record<ReviewModuleId, string> = {
  logging: '📝 Log injection',
  'bug-patch': '🐛 Bug auto-patch',
  health: '🏥 Health endpoint',
  sentry: '🚨 Sentry SDK',
  env: '🔧 .env.example',
  verify: '✅ Verification',
};

/** Sentinel bundle used when no enhance run or audit has produced anything. */
export const EMPTY_BUNDLE_SENTINEL = {
  version: 1 as const,
  durationMs: 0,
  modules: [] as ReviewModule[],
  files: [] as ReviewFile[],
  findings: [] as ReviewFinding[],
  branchCoverage: null as BranchCoverageReport | null,
  verify: { ok: false, steps: [] } as ReviewVerify,
  audit: null as ReviewAudit | null,
};
