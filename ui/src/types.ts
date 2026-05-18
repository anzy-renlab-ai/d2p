// Mirror of daemon DTOs needed by the UI. Keep in sync with daemon/src/types.ts.

export type SessionStatus = 'SETUP' | 'LOOPING' | 'PAUSED' | 'DONE' | 'ENDED';
export type GapStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'SKIPPED'
  | 'NEED_HUMAN'
  | 'SPLIT_DONE';
export type Severity = 'P1' | 'P2' | 'P3';
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

export type SessionMode = 'local-merge' | 'github-pr';

export interface Session {
  id: number;
  demoId: number;
  startedAt: number;
  endedAt: number | null;
  status: SessionStatus;
  visionMdPath: string | null;
  presetType: ProjectType | null;
  mode: SessionMode;
  githubRepo: string | null;
  baseBranch: string;
}

export interface Demo {
  id: number;
  path: string;
  firstSeenAt: number;
  lastSessionAt: number | null;
  inferredType: ProjectType | null;
}

export interface PresetStatusItem {
  item: string;
  status: 'done' | 'partial' | 'missing';
  note: string | null;
}

export interface Gap {
  id: number;
  sessionId: number;
  slug: string;
  title: string;
  body: string;
  category: string;
  severity: Severity;
  source: 'preset' | 'vision' | 'both';
  suggestedApproach: string;
  expectedFilesChanged: string[];
  status: GapStatus;
  dynamicK: number | null;
  parentGapId: number | null;
  createdAt: number;
  finishedAt: number | null;
  complexity?: GapComplexity;
}

export interface VisionQuestion {
  id: string;
  question: string;
  options: { label: string; description: string }[];
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

export interface DetectorOutput {
  type: ProjectType;
  confidence: number;
  evidence: string[];
  presetCandidates: ProjectType[];
  inferredCheckCommands: { build: string; test: string; typecheck: string };
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
  kind: string;
  level: 'info' | 'warn' | 'error';
  payload: Record<string, unknown>;
}

export interface LoopState {
  isRunning: boolean;
  pauseRequested: boolean;
  sessionId: number | null;
}

export type GapComplexity = 'simple' | 'complex';
export type MultiTurnPhase = 'idle' | 'running' | 'paused' | 'finalizing' | 'done';
export type TurnStatus = 'done' | 'running' | 'pending';

export interface ScratchpadNote {
  turn: number;
  ts: number;
  text: string;
}

export interface MultiTurnTurn {
  index: number;
  title: string;          // 短动作: "扫描代码" / "写中间件" / "跑测试"
  summary: string;        // 短结果: "5 个文件受影响" / "middleware.ts" / "3 失败 → 修 mockSecret"
  status: TurnStatus;
  ts: number;             // when this turn started (or completed if status === 'done')
}

export interface MultiTurnState {
  runId: string;
  gapId: number;
  gapTitle: string;
  gapSlug: string;
  complexity: GapComplexity;
  phase: MultiTurnPhase;
  currentTurn: number;
  maxTurns: number;
  ccSessionId: string | null;
  elapsedMs: number;
  capMs: number;
  tokensIn: number;
  tokensOut: number;
  estimatedUsd: number;
  lastAssistantText: string;
  scratchpad: ScratchpadNote[];
  turns: MultiTurnTurn[];
  selfReportedComplete: boolean;
}
