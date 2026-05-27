/**
 * ZeroU ReviewBundle wire contract.
 *
 * Worker A (cli/agent/zerou-runner) produces JSON matching this shape and
 * writes it to runs/<runTs>/review-data.json. Worker C's local server reads
 * that file and injects `window.__ZEROU_DATA__` or serves it at
 * /api/review-data.json (and /api/runs/<runTs>/review-data.json).
 *
 * This file is the SINGLE SOURCE OF TRUTH for the UI side. Do NOT add
 * implementation details here. If the cli/agent contract changes, edit this
 * file and re-run worker A's tests against the same TypeScript types.
 */
export interface ReviewBundle {
  version: 1;
  project: { name: string; cwd: string; branch: string; worktreePath: string; runTs: string };
  generatedAt: string;
  durationMs: number;
  modules: ReviewModule[];
  files: ReviewFile[];
  findings: ReviewFinding[];
  branchCoverage: BranchCoverageReport | null;
  verify: ReviewVerify;
  audit: ReviewAudit | null;
}
export interface ReviewModule { id: 'logging' | 'bug-patch' | 'health' | 'sentry' | 'env' | 'verify'; label: string; status: 'ok' | 'skipped' | 'partial' | 'failed'; summary: string; filesTouched: number; details?: Record<string, unknown>; }
export interface ReviewFile { path: string; oldPath?: string; status: 'added' | 'modified' | 'deleted' | 'renamed'; additions: number; deletions: number; modules: ReviewModule['id'][]; unifiedDiff: string; omittedReason?: string; reason?: string; }
export interface ReviewFinding { id: string; source: 'static' | 'test-fail'; severity: 'P1' | 'P2' | 'P3'; category: string; file: string; line: number; message: string; expectedBehavior?: string; actualBehavior?: string; snippet?: string; status: 'patched' | 'skipped' | 'failed' | 'unpatched'; reason?: string; }
export interface ReviewVerify { ok: boolean; steps: Array<{ name: 'install' | 'tsc' | 'test' | 'build'; status: 'pass' | 'fail' | 'skipped'; durationMs: number; failOutput?: string }>; brokenBy?: string; }
export interface ReviewAudit { durationMs: number; hardeningFindings: number; testCases: { total: number; pass: number; fail: number; inconclusive: number; skipped: number } }
// Re-declare BranchCoverageReport summary shape (keep ui side decoupled from cli/agent/*):
export interface BranchCoverageReport { generatedAt: string; cwd: string; functions: Array<{ id: string; file: string; name: string; line: number; branchCount: number; coveredCount: number; selfDeceivingCount: number; untestedCount: number; root: BranchNode; associatedSpecs: Array<{ specId: string; specName: string; status: string; category: string }> }>; summary: { functionsAnalyzed: number; branchesTotal: number; branchesCovered: number; selfDeceivingTotal: number; untestedTotal: number; functionsWithSelfDeception: number }; availability: { ast: boolean; spec: boolean; judge: boolean; runtime: boolean } }
export interface BranchNode { id: string; label: string; lineStart: number; lineEnd: number; kind: string; children: BranchNode[]; ast: { present: true }; specMatches: Array<{ specId: string; specName: string; matchedTokens: string[] }>; judgeEvidence: Array<{ specId: string; status: string; snippet: string }>; runtimeCoverage: { linesTotal: number; linesCovered: number; branchHit: boolean | null }; verdict: 'covered' | 'judge-only' | 'spec-only' | 'run-only' | 'untested' | 'unknown' }
