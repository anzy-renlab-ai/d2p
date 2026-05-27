/**
 * Phase 10 enhance — shared types across all enhance modules.
 *
 * Authority: docs/plans/2026-05-27-phase-10-enhance.md "模块契约"
 *
 * Workers must import from this file rather than redefining shapes.
 */
import type { EngineConfig } from '../stubs.js';
import type { TrackLogger } from '../log-types.js';
import type { BranchCoverageReport } from '../agent/branch-coverage-types.js';

export type Framework =
  | 'next.js'
  | 'express'
  | 'fastify'
  | 'koa'
  | 'nest.js'
  | 'unknown';

export type LoggerLib = 'pino' | 'winston' | 'bunyan' | 'existing-pino' | 'existing-winston' | 'existing-bunyan';

export type LogSiteKind =
  | 'http-boundary'        // wrap req/res with logger
  | 'silent-catch'         // catch (e) {} or catch returning null/undefined
  | 'console-log'          // console.log → logger.info
  | 'db-call'              // before/after db.* call
  | 'external-fetch'       // before/after fetch / axios call
  | 'error-rethrow'        // catch + throw with no log
  | 'unhandled-promise';   // .catch(noop) / missing await

export interface LogSite {
  file: string;                    // POSIX relative to cwd
  line: number;                    // 1-based
  endLine: number;
  kind: LogSiteKind;
  preview: string;                 // first ~120 chars
}

export interface InjectionPlan {
  loggerLib: LoggerLib;
  framework: Framework;
  installDeps: string[];           // ['pino', 'pino-http']
  bootstrapFile: string | null;    // 'src/logger.ts' to create, or null if existing
  middlewareFile: string | null;   // 'src/middleware.ts' (Next.js) or null
  sites: LogSite[];
}

export interface PlannerOpts {
  cwd: string;
  framework: Framework;
  logger: TrackLogger;
}

// ── Bug patcher ─────────────────────────────────────────────────────────────

export interface AuditFinding {
  id: string;
  file: string;
  line: number;
  severity: 'P1' | 'P2' | 'P3';
  category: string;
  message: string;
  snippet?: string;
  expectedBehavior?: string;
  actualBehavior?: string;
}

export interface PatchResult {
  finding: AuditFinding;
  status: 'applied' | 'skipped' | 'failed';
  reason?: string;
  diff?: string;                   // unified diff
}

export interface PatcherOpts {
  cwd: string;
  findings: AuditFinding[];
  criticConfig: EngineConfig | null;
  criticApiKey: string | null;
  logger: TrackLogger;
  /** Test seam — override LLM call. */
  callLLM?: PatchLlmFn;
}

export type PatchLlmFn = (args: {
  systemPrompt: string;
  userPrompt: string;
  cfg: EngineConfig;
  apiKey: string;
  timeoutMs: number;
}) => Promise<{ ok: true; rawText: string } | { ok: false; error: string }>;

// ── Standalone modules (D/E/F) ──────────────────────────────────────────────

export interface HealthGenResult {
  added: string | null;            // path of file created, or null if already present
  reason?: string;                 // 'already-exists' / 'framework-unsupported' etc.
}

export interface SentryInstallResult {
  added: string[];                 // paths of created config files
  dependencies: string[];          // 'package.json' deps to add
  bootstrapPatched: string | null; // path of bootstrap file modified
}

export interface EnvCompleteResult {
  added: string[];                 // var names appended
  existed: string[];               // var names already present
  unusedRemoved: string[];         // present in .env.example but unused (NOT removed; reported only)
}

export interface FrameworkOpts {
  cwd: string;
  framework: Framework;
  logger: TrackLogger;
}

// ── Verification ────────────────────────────────────────────────────────────

export type VerifyStepStatus = 'pass' | 'fail' | 'skipped';

export interface VerifyStep {
  name: 'tsc' | 'test' | 'build' | 'install';
  status: VerifyStepStatus;
  durationMs: number;
  stdout: string;                  // capped 4000 chars
  stderr: string;                  // capped 4000 chars
  exitCode: number | null;
}

export interface VerifyResult {
  ok: boolean;                     // all required steps passed
  steps: VerifyStep[];
  /** Per-module roll-up if any module's changes broke a step. */
  brokenBy?: string;
}

export interface VerifyOpts {
  cwd: string;
  testScript?: string;             // override default 'npm test'
  buildScript?: string;            // override default 'npm run build'
  skipBuild?: boolean;             // default false; useful for non-bundled CLIs
  logger: TrackLogger;
  timeoutMs?: number;              // default 600_000
}

// ── Aggregate flow result + report ──────────────────────────────────────────

export interface EnhanceFlowResult {
  worktreePath: string;
  branch: string;
  modules: {
    logPlanner?: InjectionPlan;
    logExecutor?: { filesChanged: string[]; failures: { file: string; reason: string }[] };
    bugPatcher?: PatchResult[];
    healthGen?: HealthGenResult;
    sentryInstaller?: SentryInstallResult;
    envCompleter?: EnvCompleteResult;
  };
  verify?: VerifyResult;
  durationMs: number;
  startedAt: string;
}

// ── Inline-diff rendering ──────────────────────────────────────────────────

export type FileDiffStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface FileDiff {
  /** POSIX relative path (post-rename for renamed entries). */
  file: string;
  /** For renamed entries, the original path. */
  oldFile?: string;
  status: FileDiffStatus;
  additions: number;
  deletions: number;
  /**
   * FULL `git diff` unified text for this single file. May be huge — the
   * renderer caps to ~200 lines (first 100 + ellipsis + last 100) and
   * elides entirely above 50 KB.
   */
  unifiedDiff: string;
  /**
   * If the diff was deliberately omitted (binary, generated, lockfile),
   * a short human-readable reason rendered in the report.
   */
  omittedReason?: string;
}

/**
 * Signature for the default + injectable diff fetcher. Resolves `main..HEAD`
 * in the worktree and returns one `FileDiff` per changed file. Implementations
 * must NEVER throw on missing-main or missing-git; they must instead reject
 * with an Error whose message the renderer surfaces verbatim.
 */
export type DiffFetcher = (worktreePath: string) => Promise<FileDiff[]>;

export interface ReportOpts {
  cwd: string;                     // worktree path
  reportPath: string;              // .zerou/enhance-report.md (in user's cwd or worktree)
  result: EnhanceFlowResult;
  logger: TrackLogger;
  /**
   * Optional override for diff-fetching. When omitted, the default fetcher
   * shells out to `git -C <worktreePath> diff main..HEAD` (falling back to
   * master then HEAD~1). Tests inject mocks here. The fetcher runs against
   * `result.worktreePath`, not `cwd`.
   */
  diffFetcher?: DiffFetcher;
  /**
   * Optional per-function branch coverage report (Phase 11.5). When present,
   * the HTML report renders a FUNCTIONS section between FINDINGS and VERIFY.
   */
  branchCoverage?: BranchCoverageReport;
}
