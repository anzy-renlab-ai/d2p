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
  /** Optional — Phase 13 branch-trace.jsonl events. Worker A's endpoint
   *  populates this; absent ⇒ UI degrades to static branch-tree (no log
   *  stream). One event per branch leaf. */
  branchTraceEvents?: BranchTraceEvent[];
}
export interface ReviewModule { id: 'logging' | 'bug-patch' | 'health' | 'sentry' | 'env' | 'verify'; label: string; status: 'ok' | 'skipped' | 'partial' | 'failed'; summary: string; filesTouched: number; details?: Record<string, unknown>; }
export interface ReviewFile { path: string; oldPath?: string; status: 'added' | 'modified' | 'deleted' | 'renamed'; additions: number; deletions: number; modules: ReviewModule['id'][]; unifiedDiff: string; omittedReason?: string; reason?: string; }
export interface ReviewFinding { id: string; source: 'static' | 'test-fail'; severity: 'P1' | 'P2' | 'P3'; category: string; file: string; line: number; message: string; expectedBehavior?: string; actualBehavior?: string; snippet?: string; status: 'patched' | 'skipped' | 'failed' | 'unpatched'; reason?: string; }
export interface ReviewVerify { ok: boolean; steps: Array<{ name: 'install' | 'tsc' | 'test' | 'build'; status: 'pass' | 'fail' | 'skipped'; durationMs: number; failOutput?: string }>; brokenBy?: string; }
export interface ReviewAudit { durationMs: number; hardeningFindings: number; testCases: { total: number; pass: number; fail: number; inconclusive: number; skipped: number } }
// Re-declare BranchCoverageReport summary shape (keep ui side decoupled from cli/agent/*):
export interface BranchCoverageReport { generatedAt: string; cwd: string; functions: Array<{ id: string; file: string; name: string; line: number; branchCount: number; coveredCount: number; selfDeceivingCount: number; untestedCount: number; root: BranchNode; associatedSpecs: Array<{ specId: string; specName: string; status: string; category: string }> }>; summary: { functionsAnalyzed: number; branchesTotal: number; branchesCovered: number; selfDeceivingTotal: number; untestedTotal: number; functionsWithSelfDeception: number }; availability: { ast: boolean; spec: boolean; judge: boolean; runtime: boolean } }
export interface BranchNode { id: string; label: string; lineStart: number; lineEnd: number; kind: string; children: BranchNode[]; ast: { present: true }; specMatches: Array<{ specId: string; specName: string; matchedTokens: string[] }>; judgeEvidence: Array<{ specId: string; status: string; snippet: string }>; runtimeCoverage: { linesTotal: number; linesCovered: number; branchHit: boolean | null }; verdict: 'covered' | 'judge-only' | 'spec-only' | 'run-only' | 'untested' | 'unknown' }

// ── Branch trace event (Phase 13 — log-as-proof artifact) ──────────────────
// Each line of .zerou/branch-trace.jsonl is one of these. Worker A's
// /api/branch-trace endpoint serves the file; worker C's stream hook tails it.
// The UI side does NOT verify the hash chain — it just renders. Mirror of
// cli/src/agent/branch-trace.ts BranchTraceEvent.
export interface BranchTraceEvent {
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
  'code.namespace'?: string;
  signals: {
    ast: true;
    spec: boolean;
    judge: boolean;
    run: boolean | null;
  };
  verdict: BranchNode['verdict'];
  evidence: {
    spec_ids: string[];
    judge_specs?: Array<{
      spec_id: string;
      status: string;
      snippet_preview: string;
    }>;
    runtime_hits?: number;
  };
  seq: number;
  prev_hash: string;
  hash: string;
}

// Pipeline stage status — drives stage card status glyph + ring colour.
// Worker C's stream hook may update these in flight (running) — static mode
// always renders done/fail/pending derived from bundle data.
export type StageStatus = 'pending' | 'running' | 'done' | 'fail';

// ── Log event (non-branch SSE log.append stream) ───────────────────────────
// Worker A's /api/stream emits `event: log.append` lines whose payload
// matches this shape. UI uses these for the run-log feed and stage-card
// transitions. Unknown / future fields land in `extra` so the UI doesn't
// have to bump types every time the cli adds an enum value.
export interface LogEvent {
  /** Logging track / channel — e.g. 'static', 'patch', 'verify', 'audit'. */
  track: string;
  /** Event name — e.g. 'stage.start', 'stage.done', 'finding.new'. */
  event: string;
  /** RFC-3339 timestamp. */
  ts: string;
  /** OpenTelemetry-style trace id, when available. */
  trace_id?: string;
  /** Optional span id within the trace. */
  span_id?: string;
  /** Monotonic per-stream sequence number used for Last-Event-ID resume.
   *  Worker A's server sets the SSE `id:` field to this value. */
  seq?: number;
  /** Anything else the producer wanted to attach. */
  [key: string]: unknown;
}
