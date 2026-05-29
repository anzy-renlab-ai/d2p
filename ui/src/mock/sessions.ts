// Mock data for the Sessions 看板 + L2 timeline + Commits + Rewind.
// Used by demo mode and Preview routes. Real data sources (Batch 5+ wire-in
// candidates) are noted alongside each export.

export type AgentRole =
  | 'differ'
  | 'implementer'
  | 'alignment'
  | 'behavioral'
  | 'adversarial'
  | 'done-check'
  | 'repo-summary';

export type AgentStatus = 'working' | 'idle' | 'blocked' | 'stale' | 'done';

export interface AgentSession {
  role: AgentRole;
  status: AgentStatus;
  currentGapSlug: string | null;
  currentGapTitle: string | null;
  lastTurnSummary: string;       // 1 sentence — "for the user", not the raw event
  turnCountThisGap: number;
  callsThisSession: number;
  lastActivityTs: number;
}

export interface SessionTurnEntry {
  turn: number;
  ts: number;
  gapSlug: string;
  inputSummary: string;          // what this turn was asked to do
  outputSummary: string;         // what cc replied with
  commitSha: string | null;      // git commit emitted by this turn, if any
  checkpointTag: string | null;  // rewind anchor name, if this turn produced one
  toolUses: string[];            // ["Read src/auth.ts", "Bash npm test"]
}

export interface CommitEntry {
  sha: string;
  shortSha: string;
  ts: number;
  gapSlug: string;
  gapTitle: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  message: string;
  /** Reviewer verdicts that approved this commit before merge. */
  reviewVerdicts: { kind: 'alignment' | 'behavioral' | 'adversarial'; verdict: 'pass' | 'fail' | 'partial'; score?: number }[];
}

export interface CheckpointAnchor {
  tag: string;            // "auto:before-jwt-merge"
  commitSha: string;
  ts: number;
  description: string;
}

const NOW = Date.now();
const m = (mins: number) => NOW - mins * 60_000;

export const mockAgentSessions: AgentSession[] = [
  {
    role: 'differ',
    status: 'idle',
    currentGapSlug: null,
    currentGapTitle: null,
    lastTurnSummary: '产出 8 个 gap，等下一轮触发',
    turnCountThisGap: 0,
    callsThisSession: 3,
    lastActivityTs: m(12),
  },
  {
    role: 'implementer',
    status: 'working',
    currentGapSlug: 'auth-jwt-on-mutating-routes',
    currentGapTitle: '所有 mutating 路由必须有 JWT 鉴权',
    lastTurnSummary: '中间件写好，正在跑测试看反馈',
    turnCountThisGap: 3,
    callsThisSession: 7,
    lastActivityTs: m(0.3),
  },
  {
    role: 'alignment',
    status: 'idle',
    currentGapSlug: null,
    currentGapTitle: null,
    lastTurnSummary: '上一 gap 通过（0.87 / 1.0），等 implementer 收尾',
    turnCountThisGap: 0,
    callsThisSession: 6,
    lastActivityTs: m(4),
  },
  {
    role: 'behavioral',
    status: 'idle',
    currentGapSlug: null,
    currentGapTitle: null,
    lastTurnSummary: '上一 gap 跑 npm test 通过',
    turnCountThisGap: 0,
    callsThisSession: 5,
    lastActivityTs: m(8),
  },
  {
    role: 'adversarial',
    status: 'idle',
    currentGapSlug: null,
    currentGapTitle: null,
    lastTurnSummary: '仅高敏 gap 触发；本次会话还没派出',
    turnCountThisGap: 0,
    callsThisSession: 1,
    lastActivityTs: m(28),
  },
  {
    role: 'done-check',
    status: 'idle',
    currentGapSlug: null,
    currentGapTitle: null,
    lastTurnSummary: '上次终评：vision 部分满足 (3 / 5 acceptance)',
    turnCountThisGap: 0,
    callsThisSession: 1,
    lastActivityTs: m(35),
  },
];

export const mockTimelinesByRole: Record<AgentRole, SessionTurnEntry[]> = {
  differ: [
    {
      turn: 1,
      ts: m(40),
      gapSlug: '(pass-1)',
      inputSummary: '扫 preset + vision + repo summary，找 gap',
      outputSummary: '产出 12 个 gap：5 P1 / 5 P2 / 2 P3',
      commitSha: null,
      checkpointTag: null,
      toolUses: ['读 package.json', '读 .d2p/preset.md', '读 .d2p/vision.md'],
    },
    {
      turn: 2,
      ts: m(20),
      gapSlug: '(pass-2)',
      inputSummary: '上轮 4 个 gap 已 DONE，找新 gap',
      outputSummary: '产出 3 个新 gap：1 P1 / 2 P2',
      commitSha: null,
      checkpointTag: null,
      toolUses: ['读 package.json', '读 .d2p/preset.md'],
    },
    {
      turn: 3,
      ts: m(12),
      gapSlug: '(pass-3)',
      inputSummary: '上轮 2 个 gap 已 DONE，找新 gap',
      outputSummary: '没找到新 gap，stuck streak = 1',
      commitSha: null,
      checkpointTag: null,
      toolUses: ['读 .d2p/preset.md'],
    },
  ],
  implementer: [
    {
      turn: 1,
      ts: m(35),
      gapSlug: 'readme-quickstart',
      inputSummary: '加 README 的 install + run 块',
      outputSummary: '补了 3 行 fenced bash + 1 段简介，typecheck 通过',
      commitSha: 'a1b2c3def456789',
      checkpointTag: null,
      toolUses: ['读 README.md', '改 README.md', '跑 npx tsc'],
    },
    {
      turn: 2,
      ts: m(28),
      gapSlug: 'env-example',
      inputSummary: '补全 .env.example 覆盖所有 env 引用',
      outputSummary: '加了 6 个 var，每个带 1 行注释',
      commitSha: 'b2c3d4ef567890a',
      checkpointTag: null,
      toolUses: ['全文搜索 process.env', '改 .env.example'],
    },
    {
      turn: 3,
      ts: m(4),
      gapSlug: 'auth-jwt-on-mutating-routes',
      inputSummary: '所有 POST/PUT/DELETE 路由套上 JWT 中间件',
      outputSummary: 'turn 1: 扫到 4 路由 + 1 测试。turn 2: 中间件草稿。turn 3 正在跑测试',
      commitSha: null,
      checkpointTag: 'auto:before-jwt-implementer',
      toolUses: ['读 src/app.ts', '读 src/routes/*', '改 src/middleware/verifyJwt.ts', '跑 npm test'],
    },
  ],
  alignment: [
    {
      turn: 1,
      ts: m(34),
      gapSlug: 'readme-quickstart',
      inputSummary: '判 readme-quickstart 的 fix 是否对题',
      outputSummary: 'score 0.92 · addressesGap ✓ · 无 scope creep',
      commitSha: null,
      checkpointTag: null,
      toolUses: [],
    },
    {
      turn: 2,
      ts: m(27),
      gapSlug: 'env-example',
      inputSummary: '判 env-example 是否覆盖完整',
      outputSummary: 'score 0.87 · addressesGap ✓ · concerns: 缺一个 DEBUG 注释',
      commitSha: null,
      checkpointTag: null,
      toolUses: [],
    },
  ],
  behavioral: [
    {
      turn: 1,
      ts: m(33),
      gapSlug: 'readme-quickstart',
      inputSummary: '跑 npm test + npx tsc',
      outputSummary: 'tsc 通过 · vitest 12 / 12 · build 通过',
      commitSha: null,
      checkpointTag: null,
      toolUses: ['跑 npx tsc', '跑 npm test'],
    },
    {
      turn: 2,
      ts: m(26),
      gapSlug: 'env-example',
      inputSummary: '跑 build 验 env 变量',
      outputSummary: 'build 通过 · 启动后所有 var 被读到',
      commitSha: null,
      checkpointTag: null,
      toolUses: ['跑 npm run build', '跑 node dist/index.js'],
    },
  ],
  adversarial: [
    {
      turn: 1,
      ts: m(28),
      gapSlug: 'password-hash',
      inputSummary: '搜密码学常见错（高敏 gap 触发）',
      outputSummary: '未发现弱算法 · argon2 配置 OK',
      commitSha: null,
      checkpointTag: null,
      toolUses: ['全文搜索 bcrypt|md5|sha1'],
    },
  ],
  'done-check': [
    {
      turn: 1,
      ts: m(35),
      gapSlug: '(终评-1)',
      inputSummary: '看 vision 是否双绿',
      outputSummary: 'preset 18 / 32 · vision 3 / 5 → 继续',
      commitSha: null,
      checkpointTag: null,
      toolUses: ['读 .d2p/vision.md'],
    },
  ],
  'repo-summary': [],
};

export const mockCommits: CommitEntry[] = [
  {
    sha: 'b2c3d4ef567890a1234567890abcdef1234567890',
    shortSha: 'b2c3d4e',
    ts: m(27),
    gapSlug: 'env-example',
    gapTitle: '.env.example 覆盖所有 env 引用',
    filesChanged: 1,
    insertions: 9,
    deletions: 0,
    message: 'feat(env): document 6 env vars in .env.example',
    reviewVerdicts: [
      { kind: 'alignment', verdict: 'pass', score: 0.87 },
      { kind: 'behavioral', verdict: 'pass' },
    ],
  },
  {
    sha: 'a1b2c3def4567890abcdef1234567890abcdef12',
    shortSha: 'a1b2c3d',
    ts: m(35),
    gapSlug: 'readme-quickstart',
    gapTitle: 'README 加 install + run 块',
    filesChanged: 1,
    insertions: 14,
    deletions: 2,
    message: 'docs(readme): add quickstart with fenced install + run',
    reviewVerdicts: [
      { kind: 'alignment', verdict: 'pass', score: 0.92 },
      { kind: 'behavioral', verdict: 'pass' },
    ],
  },
  {
    sha: '9f8e7d6c5b4a3210fedcba9876543210abcdef98',
    shortSha: '9f8e7d6',
    ts: m(42),
    gapSlug: 'lockfile-present',
    gapTitle: '提交 package-lock.json',
    filesChanged: 1,
    insertions: 8124,
    deletions: 0,
    message: 'chore: commit package-lock.json (npm install)',
    reviewVerdicts: [{ kind: 'alignment', verdict: 'pass', score: 1.0 }],
  },
];

export const mockCheckpoints: CheckpointAnchor[] = [
  {
    tag: 'auto:before-jwt-implementer',
    commitSha: 'b2c3d4ef567890a1234567890abcdef1234567890',
    ts: m(4),
    description: '自治 implementer 开始前的自动快照（auth-jwt-on-mutating-routes）',
  },
  {
    tag: 'auto:before-merge-env-example',
    commitSha: 'a1b2c3def4567890abcdef1234567890abcdef12',
    ts: m(28),
    description: 'env-example merge 到 main 前的快照',
  },
  {
    tag: 'auto:session-start',
    commitSha: '9f8e7d6c5b4a3210fedcba9876543210abcdef98',
    ts: m(45),
    description: '会话开始时的初始状态',
  },
];

export const AGENT_LABEL: Record<AgentRole, { zh: string; color: string }> = {
  differ: { zh: '差异分析', color: 'text-coral' },
  implementer: { zh: '实施者', color: 'text-rust' },
  alignment: { zh: '对题审', color: 'text-forest' },
  behavioral: { zh: '行为审', color: 'text-forest' },
  adversarial: { zh: '对抗审', color: 'text-forest' },
  'done-check': { zh: '终评', color: 'text-ink' },
  'repo-summary': { zh: '仓库摘要', color: 'text-muted' },
};

export const STATUS_LABEL: Record<AgentStatus, { zh: string; color: string; dot: string }> = {
  working: { zh: '工作中', color: 'text-coral', dot: 'bg-coral text-coral anim-status-pulse' },
  idle: { zh: '空闲', color: 'text-muted', dot: 'bg-muted/40' },
  blocked: { zh: '阻塞', color: 'text-rust', dot: 'bg-rust' },
  stale: { zh: '陈旧', color: 'text-muted/60', dot: 'bg-muted/30' },
  done: { zh: '完成', color: 'text-forest', dot: 'bg-forest' },
};
