// Mock data + simulated stream for the multi-turn (complex gap) UI.
// Used by Preview pages and component tests; the real daemon will replace
// startMockStream() with an SSE subscription in Batch 5.

import type { MultiTurnState, MultiTurnTurn, ScratchpadNote } from '../types.js';

const NOW = Date.now();

const RUNNING_TURNS: MultiTurnTurn[] = [
  { index: 1, title: '扫描代码识别影响范围', summary: '5 个文件受影响 · 4 个路由 + 1 测试', status: 'done', ts: NOW - 4 * 60_000 },
  { index: 2, title: '写中间件草稿 + 接入 app.ts', summary: 'middleware/verifyJwt.ts · body-parser 之后注册', status: 'done', ts: NOW - 3 * 60_000 },
  { index: 3, title: '跑测试看反馈', summary: '进行中', status: 'running', ts: NOW - 30_000 },
];

const FINALIZING_TURNS: MultiTurnTurn[] = [
  { index: 1, title: '扫描代码识别影响范围', summary: '5 个文件受影响', status: 'done', ts: NOW - 5 * 60_000 },
  { index: 2, title: '写中间件草稿', summary: 'middleware/verifyJwt.ts', status: 'done', ts: NOW - 4 * 60_000 },
  { index: 3, title: '跑测试看反馈', summary: '3 失败 → 修 mockSecret 加载', status: 'done', ts: NOW - 3 * 60_000 },
  { index: 4, title: '收尾 lint 警告', summary: '窄化 any-cast → UnauthorizedError', status: 'done', ts: NOW - 1.5 * 60_000 },
  { index: 5, title: '自报完成', summary: '中间件 / 测试 / docs/auth.md 齐了', status: 'done', ts: NOW - 0.4 * 60_000 },
];

const DONE_TURNS: MultiTurnTurn[] = [
  ...FINALIZING_TURNS,
];

export const mockScratchpad: ScratchpadNote[] = [
  { turn: 1, ts: NOW - 4 * 60_000, text: 'turn 1: scanned src/auth, no JWT middleware, route handlers leak token in console.log' },
  { turn: 1, ts: NOW - 3.8 * 60_000, text: 'turn 1: drafted middleware/verifyJwt.ts; added to app.ts after body-parser' },
  { turn: 2, ts: NOW - 2.2 * 60_000, text: 'turn 2: tests fail — mockSecret env not loaded; switched to dotenv.config({ path: .env.test })' },
  { turn: 2, ts: NOW - 1.9 * 60_000, text: 'turn 2: tests pass 14/14; lint flags any-cast in error handler — narrowed to UnauthorizedError' },
  { turn: 3, ts: NOW - 0.4 * 60_000, text: 'turn 3: implementer reports complete; covered: middleware, tests, error mapping, docs/auth.md' },
];

export const mockMultiTurnRunning: MultiTurnState = {
  runId: 'run_8f1b1a2',
  gapId: 17,
  gapTitle: '所有 mutating 路由必须有 JWT 鉴权',
  gapSlug: 'auth-jwt-on-mutating-routes',
  complexity: 'complex',
  phase: 'running',
  currentTurn: 3,
  maxTurns: 12,
  ccSessionId: 'cc-sess-abc123def456',
  elapsedMs: 4 * 60_000 + 23 * 1000,
  capMs: 6 * 60 * 60 * 1000, // 6h
  tokensIn: 18_240,
  tokensOut: 6_120,
  estimatedUsd: 0.42,
  lastAssistantText:
    '中间件草稿写好，接到 app.ts 的 body-parser 之后。现在跑测试看反馈。',
  scratchpad: mockScratchpad,
  turns: RUNNING_TURNS,
  selfReportedComplete: false,
};

export const mockMultiTurnIdle: MultiTurnState = {
  runId: '',
  gapId: 0,
  gapTitle: '',
  gapSlug: '',
  complexity: 'simple',
  phase: 'idle',
  currentTurn: 0,
  maxTurns: 0,
  ccSessionId: null,
  elapsedMs: 0,
  capMs: 0,
  tokensIn: 0,
  tokensOut: 0,
  estimatedUsd: 0,
  lastAssistantText: '',
  scratchpad: [],
  turns: [],
  selfReportedComplete: false,
};

export const mockMultiTurnFinalizing: MultiTurnState = {
  ...mockMultiTurnRunning,
  phase: 'finalizing',
  currentTurn: 5,
  selfReportedComplete: true,
  lastAssistantText: '所有变更已完成，等 reviewer 把关。',
  turns: FINALIZING_TURNS,
};

export const mockMultiTurnDone: MultiTurnState = {
  ...mockMultiTurnRunning,
  phase: 'done',
  currentTurn: 5,
  selfReportedComplete: true,
  lastAssistantText: 'reviewer pipeline 通过；已 merge 到 main。',
  turns: DONE_TURNS,
};

export const mockMultiTurnPaused: MultiTurnState = {
  ...mockMultiTurnRunning,
  phase: 'paused',
  turns: RUNNING_TURNS.map((t) => (t.status === 'running' ? { ...t, summary: '已暂停' } : t)),
};

const TURN_DEFS: { title: string; summary: string }[] = [
  { title: '扫描代码识别影响范围', summary: '5 个文件受影响 · 4 个路由 + 1 测试' },
  { title: '写中间件草稿 + 接入', summary: 'middleware/verifyJwt.ts · body-parser 之后' },
  { title: '跑测试看反馈', summary: '3 失败 → 修 mockSecret 加载' },
  { title: '收尾 lint 警告', summary: '窄化 any-cast → UnauthorizedError' },
  { title: '自报完成', summary: '中间件 / 测试 / docs/auth.md 齐了' },
];

const ASSISTANT_LINES = [
  '正在扫描代码库的鉴权现状…',
  '中间件草稿写好，跑测试看反馈。',
  '测试通过，处理 lint 警告。',
  '收尾，写文档。',
  '所有变更已完成，等 reviewer。',
];

const TURN_NOTES = [
  'scanned src/, identified gap surface (middleware + 4 route handlers + 1 test file)',
  'wrote middleware + wired into app.ts; ran tests — 3 failures around mockSecret',
  'switched to dotenv.config({ path: .env.test }); 14/14 tests passing',
  'lint flagged any-cast in error handler; narrowed to UnauthorizedError class',
  'self-report: complete — middleware, tests, error mapping, docs/auth.md all done',
];

/** Drives a Preview page through a believable multi-turn run. */
export function startMockMultiTurnStream(
  onUpdate: (s: MultiTurnState) => void,
  opts: { intervalMs?: number; maxTurns?: number } = {},
): () => void {
  const interval = opts.intervalMs ?? 1400;
  const cap = opts.maxTurns ?? 5;

  let turn = 0;
  let elapsedMs = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let scratchpad: ScratchpadNote[] = [];
  let turns: MultiTurnTurn[] = [];

  const handle = setInterval(() => {
    turn += 1;
    // Mark previous turn done
    if (turn > 1) {
      turns = turns.map((t) =>
        t.index === turn - 1 ? { ...t, status: 'done', summary: TURN_DEFS[t.index - 1]?.summary ?? '完成' } : t,
      );
    }
    if (turn > cap) {
      clearInterval(handle);
      onUpdate({
        ...mockMultiTurnRunning,
        phase: 'done',
        currentTurn: cap,
        selfReportedComplete: true,
        elapsedMs,
        tokensIn,
        tokensOut,
        estimatedUsd: estimateUsd(tokensIn, tokensOut),
        scratchpad,
        turns,
        lastAssistantText: 'reviewer pipeline 通过；已 merge 到 main。',
      });
      return;
    }
    elapsedMs += interval + Math.floor(Math.random() * 800);
    tokensIn += 2000 + Math.floor(Math.random() * 2000);
    tokensOut += 700 + Math.floor(Math.random() * 600);
    scratchpad = [
      ...scratchpad,
      { turn, ts: Date.now(), text: `turn ${turn}: ${TURN_NOTES[turn - 1] ?? '…'}` },
    ];
    const def = TURN_DEFS[turn - 1] ?? { title: `turn ${turn}`, summary: '…' };
    turns = [
      ...turns,
      { index: turn, title: def.title, summary: '进行中', status: 'running', ts: Date.now() },
    ];
    const isLast = turn === cap;
    onUpdate({
      ...mockMultiTurnRunning,
      phase: isLast ? 'finalizing' : 'running',
      currentTurn: turn,
      selfReportedComplete: isLast,
      elapsedMs,
      tokensIn,
      tokensOut,
      estimatedUsd: estimateUsd(tokensIn, tokensOut),
      scratchpad,
      turns,
      lastAssistantText: ASSISTANT_LINES[turn - 1] ?? '',
    });
  }, interval);

  return () => clearInterval(handle);
}

function estimateUsd(tIn: number, tOut: number): number {
  return (tIn * 3 + tOut * 15) / 1_000_000;
}
