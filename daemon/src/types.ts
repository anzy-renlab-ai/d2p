// Shared domain + agent IO + API DTO types. See docs/details/02-types.md.

// ─── Enums ────────────────────────────────────────────────────────────────

export type ProjectType =
  | 'saas-web'
  | 'api-service'
  | 'cli-tool'
  | 'library'
  | 'static-site'
  | 'mobile'
  | 'desktop-app'
  | 'ml-script'
  | 'unknown';

export const ALL_PROJECT_TYPES: readonly ProjectType[] = [
  'saas-web',
  'api-service',
  'cli-tool',
  'library',
  'static-site',
  'mobile',
  'desktop-app',
  'ml-script',
  'unknown',
] as const;

export type SessionStatus = 'SETUP' | 'LOOPING' | 'PAUSED' | 'DONE' | 'ENDED';

export type GapStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'SKIPPED'
  | 'NEED_HUMAN'
  | 'SPLIT_DONE';

export type FixStatus =
  | 'STARTED'
  | 'IMPLEMENTING'
  | 'STATIC_GATE_RUNNING'
  | 'STATIC_GATE_FAILED'
  | 'ALIGNMENT_RUNNING'
  | 'ALIGNMENT_FAILED'
  | 'BEHAVIORAL_RUNNING'
  | 'BEHAVIORAL_FAILED'
  | 'ADVERSARIAL_RUNNING'
  | 'ADVERSARIAL_FAILED'
  | 'MERGED'
  | 'DROPPED';

export type GapCategory =
  | 'auth'
  | 'input-validation'
  | 'sql'
  | 'ipc'
  | 'file-ops'
  | 'network'
  | 'crypto'
  | 'deploy'
  | 'data'
  | 'tests'
  | 'docs'
  | 'ui'
  | 'perf'
  | 'err'
  | 'polish'
  | 'misc';

export const ALL_GAP_CATEGORIES: readonly GapCategory[] = [
  'auth',
  'input-validation',
  'sql',
  'ipc',
  'file-ops',
  'network',
  'crypto',
  'deploy',
  'data',
  'tests',
  'docs',
  'ui',
  'perf',
  'err',
  'polish',
  'misc',
] as const;

export const HIGH_SENSITIVITY_CATEGORIES: ReadonlySet<GapCategory> = new Set<GapCategory>([
  'auth',
  'input-validation',
  'sql',
  'ipc',
  'file-ops',
  'network',
  'crypto',
  'deploy',
]);

export type Severity = 'P1' | 'P2' | 'P3';
export type GapSource = 'preset' | 'vision' | 'both';
export type ReviewKind = 'alignment' | 'behavioral' | 'adversarial';
export type Verdict = 'APPROVE' | 'RETRY_WITH_HINTS' | 'ROLLBACK' | 'ESCALATE';
export type ReasonCode =
  | 'OK'
  | 'DIVERGES_FROM_GAP'
  | 'BUGGY'
  | 'INCOMPLETE'
  | 'OVER_SCOPED'
  | 'ARCHITECTURAL'
  | 'SCOPE_TOO_LARGE'
  | 'TOO_HARD';

export type ClaudeRole =
  | 'detector'
  | 'vision'
  | 'differ'
  | 'implementer'
  | 'implementer-structured'
  | 'alignment'
  | 'behavioral'
  | 'adversarial'
  | 'done-check'
  | 'repo-summary';

export type ClaudeModel = 'haiku' | 'sonnet' | 'opus';

export type LogLevel = 'info' | 'warn' | 'error';

export type LogEventKind =
  | 'SESSION_STARTED'
  | 'VISION_QUESTION_ASKED'
  | 'VISION_ANSWERED'
  | 'VISION_FINALIZED'
  | 'TYPE_DETECTED'
  | 'PRESET_CHOSEN'
  | 'DIFF_PRODUCED'
  | 'GAP_PICKED'
  | 'WORKTREE_CREATED'
  | 'AGENT_START'
  | 'AGENT_THOUGHT'
  | 'AGENT_END'
  | 'STATIC_GATE_PASSED'
  | 'STATIC_GATE_FAILED'
  | 'ALIGNMENT_RESULT'
  | 'REVIEW_VERDICT'
  | 'ADVERSARIAL_RESULT'
  | 'FIX_COMMITTED'
  | 'FIX_DROPPED'
  | 'MERGED'
  | 'GAP_DONE'
  | 'GAP_SKIPPED'
  | 'GAP_ESCALATED'
  | 'LOOP_STARTED'
  | 'LOOP_PAUSED'
  | 'LOOP_RESUMED'
  | 'DONE_CHECK_RESULT'
  | 'SESSION_DONE'
  | 'SESSION_ENDED'
  | 'SESSION_CRASH_RECOVERED'
  | 'PATHOLOGY_DETECTED'
  | 'PATHOLOGY_CLEARED'
  | 'ERROR';

/** F3 — agent failure-mode signatures we surface as Mission Control badges. */
export type PathologyKind =
  | 'fixation'      // same gap, ≥N attempts in a row with reviewer rejection
  | 'thrash'        // >X% of recent merges reverted within Y minutes
  | 'critic-bias'   // reviewer disagreement rate exceeds threshold (suggests cross-engine off)
  | 'runaway-cost'; // spend rate per gap > threshold

export type PathologyLevel = 'info' | 'warn' | 'crit';

// ─── Branded path types ────────────────────────────────────────────────────

declare const __brand: unique symbol;
type Branded<T, B> = T & { readonly [__brand]: B };
export type AbsPath = Branded<string, 'AbsPath'>;
export type RepoPath = Branded<string, 'RepoPath'>;
export type WorktreePath = Branded<string, 'WorktreePath'>;

// ─── Domain entities ───────────────────────────────────────────────────────

export interface Demo {
  id: number;
  path: AbsPath;
  firstSeenAt: number;
  lastSessionAt: number | null;
  inferredType: ProjectType | null;
}

export type SessionMode = 'local-merge' | 'github-pr';

export interface Session {
  id: number;
  demoId: number;
  startedAt: number;
  endedAt: number | null;
  status: SessionStatus;
  visionMdPath: AbsPath | null;
  presetType: ProjectType | null;
  mode: SessionMode;
  githubRepo: string | null;        // "owner/repo" parsed from origin or user-set
  baseBranch: string;
}

export interface VisionDraft {
  id: number;
  sessionId: number;
  roundIndex: number;
  questionId: string;
  question: string;
  answer: string;
  createdAt: number;
}

export interface Gap {
  id: number;
  sessionId: number;
  slug: string;
  title: string;
  body: string;
  category: GapCategory;
  severity: Severity;
  source: GapSource;
  suggestedApproach: string;
  expectedFilesChanged: string[];
  status: GapStatus;
  dynamicK: number | null;
  parentGapId: number | null;
  createdAt: number;
  finishedAt: number | null;
}

export interface Fix {
  id: number;
  gapId: number;
  attempt: number;
  branch: string;
  worktreePath: WorktreePath;
  commitSha: string | null;
  staticGatePassed: boolean | null;
  alignmentScore: number | null;
  reviewerVerdict: Verdict | null;
  reasonCode: ReasonCode | null;
  status: FixStatus;
  stderrExcerpt: string | null;
  filesChanged: string[];
  confidence: number | null;
  prNumber: number | null;
  prUrl: string | null;
  createdAt: number;
  finishedAt: number | null;
}

export interface SplitGapSpec {
  slug: string;
  title: string;
  body: string;
}

export interface Review {
  id: number;
  fixId: number;
  kind: ReviewKind;
  model: ClaudeModel;
  verdict: Verdict | null;
  hints: string[];
  reasonCode: ReasonCode | null;
  difficulty: number | null;
  splitInto: SplitGapSpec[] | null;
  rawJson: string;
  createdAt: number;
}

export interface LogEvent {
  id: number;
  sessionId: number;
  ts: number;
  level: LogLevel;
  kind: LogEventKind;
  payload: Record<string, unknown>;
}

export interface CostRecord {
  id: number;
  sessionId: number;
  role: ClaudeRole;
  model: ClaudeModel;
  inputTokens: number;
  outputTokens: number;
  ts: number;
}

export interface PresetStatusItem {
  item: string;
  status: 'done' | 'partial' | 'missing';
  note: string | null;
}

// ─── Agent IO types ────────────────────────────────────────────────────────

export interface DetectorOutput {
  type: ProjectType;
  confidence: number;
  evidence: string[];
  presetCandidates: ProjectType[];
  inferredCheckCommands: { build: string; test: string; typecheck: string };
}

export interface VisionQuestion {
  id: string;
  question: string;
  options: { label: string; description: string }[];
}

export type VisionRoundOutput =
  | { done: false; questions: VisionQuestion[] }
  | { done: true; visionMd: string };

export interface DifferGap {
  slug: string;
  title: string;
  body: string;
  category: GapCategory;
  severity: Severity;
  source: GapSource;
  suggestedApproach: string;
  expectedFilesChanged: string[];
}

export interface DifferOutput {
  gaps: DifferGap[];
  presetStatus: PresetStatusItem[];
}

export interface ImplementerOutput {
  filesChanged: string[];
  commandsRun: string[];
  testOutputExcerpt: string;
  commitSha: string;
  residualRisks: string[];
  confidence: number;
}

export interface AlignmentOutput {
  alignment: number;
  addressesGap: boolean;
  scopeCreep: boolean;
  concerns: string[];
}

export interface BehavioralOutput {
  verdict: Verdict;
  confidence: number;
  reasonCode: ReasonCode;
  rationale: string;
  hints: string[];
  splitInto: SplitGapSpec[] | null;
  difficulty: number;
}

export interface AdversarialAttempt {
  vector: string;
  scenario: string;
  broke: boolean;
  evidence: string;
}

export interface AdversarialOutput {
  attempts: AdversarialAttempt[];
  anyBreak: boolean;
}

export interface RemainingTheme {
  theme: string;
  whyMissing: string;
  suggestedGapSlug: string;
}

export interface DoneCheckOutput {
  visionSatisfied: boolean;
  rationale: string;
  remainingThemes: RemainingTheme[];
}

export interface RepoSummary {
  entryPoints: string[];
  frameworks: string[];
  testPresent: boolean;
  authPresent: boolean;
  dbPresent: 'sqlite' | 'postgres' | 'mysql' | 'in-memory' | 'none' | 'unknown';
  deployConfigPresent: boolean;
  ciPresent: boolean;
  licensePresent: boolean;
  readmeQuality: 'rich' | 'minimal' | 'none';
  notableDeps: string[];
}

// ─── Subprocess types ──────────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type ClaudeCallResult<T = unknown> =
  | { ok: true; json: T; raw: string; usage: TokenUsage }
  | {
      ok: false;
      code: 'TIMEOUT' | 'NON_JSON' | 'SCHEMA' | 'NON_ZERO_EXIT' | 'CLAUDE_NOT_FOUND';
      message: string;
      raw: string;
    };

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

// ─── Preset types ──────────────────────────────────────────────────────────

/** Verification mechanism — tells reviewers which engine should validate
 *  this item. Drawn from F2 of docs/plans/2026-05-13-track-c-features.md. */
export type PresetMechanism =
  | 'static-grep'         // grep the codebase for forbidden / required patterns
  | 'file-exists'         // file presence/absence check
  | 'test-execution'      // run a build / test / typecheck command
  | 'cross-file-cohesion' // consistency between multiple files (alignment reviewer)
  | 'llm-judgment';       // open-ended taste / design call (alignment or behavioral reviewer)

export const ALL_PRESET_MECHANISMS: readonly PresetMechanism[] = [
  'static-grep',
  'file-exists',
  'test-execution',
  'cross-file-cohesion',
  'llm-judgment',
] as const;

/** Structured preset item — each one is independently checkable.
 *
 *  The 32-item core list lives in docs/plans/2026-05-13-track-c-features.md F2
 *  table and is distributed across project-type preset files via `appliesTo`. */
export interface PresetItem {
  id: string;
  label: string;
  severity: Severity;
  mechanism: PresetMechanism;
  /** Citation tag — "12F-VII" / "OWASP-A02:2025" / "SRE" / "WCAG-1.4.3" / "OpenSSF" / "base" / "d2p-native". */
  source: string;
  /** Project-type letters: W A C L S M D ML. Determines which presets ship the item. */
  appliesTo: string[];
}

export interface PresetFrontmatter {
  type: string;
  name: string;
  version: number;
  inherits?: string[];
  high_sensitivity_categories?: GapCategory[];
  /** Structured 32-item-style preset checklist. Loader-side validated; differ
   *  prefers this when present, otherwise falls back to parsing the markdown
   *  body for backward compatibility. */
  items?: PresetItem[];
}

export interface PresetOverridesAdd {
  slug: string;
  category: GapCategory;
  description: string;
  severity: Severity;
}

export interface PresetOverrides {
  add: PresetOverridesAdd[];
  remove: string[];
  skip: string[];
}

// ─── API DTOs ──────────────────────────────────────────────────────────────

export interface StartSessionReq {
  demoPath: string;
}
export interface StartSessionRes {
  sessionId: number;
  status: SessionStatus;
  isResume: boolean;
}

export interface CostTotals {
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
}

export interface CurrentSessionRes {
  session: Session | null;
  demo: Demo | null;
  presetStatus: PresetStatusItem[];
  costTotals: CostTotals;
}

export interface VisionAnswerItem {
  questionId: string;
  answer: string;
}
export interface VisionAnswerReq {
  answers: VisionAnswerItem[];
}

export interface VisionRoundRes {
  done: boolean;
  roundIndex?: number;
  questions?: VisionQuestion[];
  visionMd?: string;
  visionMdPath?: string;
}

export interface SseEnvelope {
  id: number;
  ts: number;
  kind: LogEventKind;
  level: LogLevel;
  payload: Record<string, unknown>;
}

export interface HealthResponse {
  ok: boolean;
  daemonVersion: string;
  promptsVersion: number;
  claudeCli: { found: boolean; version: string | null };
  gitCli: { found: boolean; version: string | null };
  dbPath: string;
  uptimeMs: number;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail?: string;
}
export interface DoctorResponse {
  ok: boolean;
  checks: DoctorCheck[];
}
