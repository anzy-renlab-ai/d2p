// Checkpoint mock — T-tier rewindable snapshots (gitbutler-style).
//
// T tiers (importance, NOT risk):
//   T0 关键 / pinned — user-pinned OR auto-tagged "must not lose": pre-merge,
//                    pre-multi-turn, vision-finalize, deploy boundaries
//   T1 普通       — auto-tagged at every fix attempt for safety; the system
//                    keeps these for ~7 days
//   T2 可清理      — auto-GC candidates; routine intermediate snapshots
//
// Checkpoints are NOT one-per-commit. They are selectively taken at moments
// where rewinding back to "right before this happened" carries value.

export type CheckpointTier = 'T0' | 'T1' | 'T2';

export interface CheckpointMock {
  /** ULID-ish id */
  id: string;
  /** Optional — checkpoint can stand alone (system-level) or attach to a commit */
  commitSha: string | null;
  /** Optional session it belongs to */
  sessionId: number | null;
  tier: CheckpointTier;
  /** Short auto-generated tag, e.g. "before-jwt-merge", "session-start-31" */
  tag: string;
  /** One-line human reason this snapshot exists */
  reason: string;
  /** Whether the user has pinned this — pinned auto-upgrades to T0 */
  pinned: boolean;
  /** Whether ZeroU flagged this as a recommended save point (vs purely
   *  automatic). high-confidence = "user should be aware this exists" */
  recommended: boolean;
  ts: number;
}

const NOW = Date.now();
const m = (mins: number) => NOW - mins * 60_000;
const h = (hours: number) => NOW - hours * 60 * 60_000;

// Per-commit checkpoint mock for agent-game-platform commits (worker B's
// mockCommits are these SHAs).
export const mockCheckpointsByCommit: Record<string, CheckpointMock[]> = {
  '4944fbae31e4dc5103303c905b9b802f7e45416a': [
    {
      id: 'ck_4944fba_pre',
      commitSha: '4944fbae31e4dc5103303c905b9b802f7e45416a',
      sessionId: 41,
      tier: 'T0',
      tag: 'before-iter2-§5-merge',
      reason: '自治 implementer 开始前的自动快照（achievements 跨 3 文件改动）',
      pinned: true,
      recommended: true,
      ts: m(46),
    },
    {
      id: 'ck_4944fba_turn1',
      commitSha: '4944fbae31e4dc5103303c905b9b802f7e45416a',
      sessionId: 41,
      tier: 'T1',
      tag: 'turn-1-scan-done',
      reason: 'multi-turn implementer turn 1 完成 — 扫描完所有 affected files',
      pinned: false,
      recommended: false,
      ts: m(38),
    },
    {
      id: 'ck_4944fba_turn3',
      commitSha: '4944fbae31e4dc5103303c905b9b802f7e45416a',
      sessionId: 41,
      tier: 'T2',
      tag: 'turn-3-lint-fix',
      reason: 'turn 3 lint 警告修完',
      pinned: false,
      recommended: false,
      ts: m(20),
    },
  ],
  '22a76544abc3d12345': [
    {
      id: 'ck_22a7654_pre',
      commitSha: '22a76544abc3d12345',
      sessionId: 38,
      tier: 'T1',
      tag: 'before-watch-room-impl',
      reason: 'highlight-classifier 实施前快照',
      pinned: false,
      recommended: false,
      ts: h(7.5),
    },
  ],
  'c5eeedb55de9abc12': [
    {
      id: 'ck_c5eeedb_pre',
      commitSha: 'c5eeedb55de9abc12',
      sessionId: 38,
      tier: 'T0',
      tag: 'before-scoring-rewrite',
      reason: 'agent self-routing 改了核心 scoring 函数 — 强烈建议保留',
      pinned: false,
      recommended: true,
      ts: h(6),
    },
    {
      id: 'ck_c5eeedb_after',
      commitSha: 'c5eeedb55de9abc12',
      sessionId: 38,
      tier: 'T0',
      tag: 'after-scoring-greenlight',
      reason: 'user 手动 pin — "this is the version that works"',
      pinned: true,
      recommended: true,
      ts: h(5.5),
    },
  ],
  '02870edaaa1234567': [
    {
      id: 'ck_02870ed_pre',
      commitSha: '02870edaaa1234567',
      sessionId: 38,
      tier: 'T1',
      tag: 'before-state-machine',
      reason: 'NL_HOLDEM_SNG state machine 实施前',
      pinned: false,
      recommended: false,
      ts: h(7),
    },
  ],
};

// Session-level standalone checkpoints (not bound to a specific commit)
export const mockSessionCheckpoints: CheckpointMock[] = [
  {
    id: 'ck_session_31_done',
    commitSha: null,
    sessionId: 31,
    tier: 'T0',
    tag: 'session-31-double-green',
    reason: 'session 31 收尾：preset + vision 双绿 — ZeroU 自动标记的成功里程碑',
    pinned: false,
    recommended: true,
    ts: m(-1), // placeholder
  },
  {
    id: 'ck_session_22_paused',
    commitSha: null,
    sessionId: 22,
    tier: 'T0',
    tag: 'session-22-need-human',
    reason: 'session 22 implementer NEED_HUMAN — 卡在 auth 流程时的状态',
    pinned: false,
    recommended: true,
    ts: m(-1),
  },
];

export const TIER_META: Record<CheckpointTier, { zhLabel: string; enLabel: string; chip: string; dot: string; ring: string }> = {
  T0: {
    zhLabel: '关键',
    enLabel: 'Critical',
    chip: 'bg-rust/10 text-rust',
    dot: 'bg-rust',
    ring: 'ring-1 ring-rust/30',
  },
  T1: {
    zhLabel: '普通',
    enLabel: 'Normal',
    chip: 'bg-warmline text-muted',
    dot: 'bg-muted/60',
    ring: 'ring-1 ring-warmline',
  },
  T2: {
    zhLabel: '辅助',
    enLabel: 'Auxiliary',
    chip: 'bg-paper text-muted/50',
    dot: 'bg-muted/30',
    ring: 'ring-1 ring-warmline/40',
  },
};

export function checkpointsForCommit(sha: string): CheckpointMock[] {
  return (
    mockCheckpointsByCommit[sha] ??
    mockCheckpointsByCommit[sha.slice(0, 7)] ??
    []
  );
}
