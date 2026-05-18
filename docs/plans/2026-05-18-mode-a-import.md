# Mode A 自治链搬迁 d2p — 双模并存

> 把 Cairn 的 `claude --output-format stream-json` + hooks turn protocol + session resume 搬进 d2p。
> 简单 gap 走原单-turn 流程；复杂 gap 走 multi-turn 自治。
> 4 层 reviewer pipeline 保留为主流程，只是触发时机后移。

**Scope source**：用户 2026-05-18 grill：
- 三个能力都要：implementer multi-turn 自治 + UI 实时进度 + session resume
- 双模并存：simple gap 单 turn / complex gap 自治
- state objects 按需挑（结论：仅借 scratchpad 概念）

---

## Acceptance checklist（开工前自检）

1. **目标**：implementer 在复杂 gap 上能跑 multi-turn 自治（≤ N turns 或自报完成）；UI SSE 流实时显示 turn 进度 + token；中断重启用 `--resume <session_id>` 续上下文
2. **不变量**：原 71 单测 + walking-skeleton smoke 全绿；4 层 reviewer pipeline 不变；GitHub PR 模式、多 LLM engine、cost cap 不动
3. **验证命令**：`npm test`（daemon + ui） / `node scripts/smoke-walking-skeleton.mjs` / `node scripts/smoke-multi-turn.mjs`（新增） + 真 cc 手 smoke 一个 complex gap
4. **不做**：① 不搬 Cairn 的 Mentor / Scout / Lead-CC / managed-loop（那些归 Pace） ② 不搬 harness-budget/pool/gc（d2p 已有 F6 budget + F3 health） ③ 不搬 8 state objects 全套（仅借 scratchpad）④ 不动产品定位文档 / 不引新 npm dep（runtime dep；devDep 看 anchor 决定）
5. **完成标准**：双模都跑通真 cc 一次；migration 落地；UI 能看到 multi-turn 进度；plan 中所有 Expected Output 物理存在；测试可由他人 clone + `npm test` 复跑

---

## Plan — 具体改什么

### A. 新文件（daemon 侧）

| 文件 | 来源 | 作用 |
|---|---|---|
| `daemon/src/engines/claude-stream.ts` | port Cairn `claude-stream-launcher.cjs` | long-lived child + stream-json 双向 stdio + NDJSON 解析 → 事件流 |
| `daemon/src/engines/claude-hooks.ts` | port Cairn `claude-settings-config.cjs` | 每次 spawn 写临时 `settings.json` 注入 SessionStart + Stop hook |
| `daemon/src/engines/claude-mcp-cfg.ts` | port Cairn `claude-mcp-config.cjs` | 每次 spawn 写临时 mcp-config（即使 d2p 不接 MCP，cc 需要这个 flag 才能用 stream-json + hooks 配合 strict mode） |
| `daemon/src/state/cc-session-store.ts` | port Cairn `mode-a-session-store.cjs` | 持久化 (run_id, role) → cc_session_id，下次 resume 用 |
| `daemon/src/orchestrator/multi-turn.ts` | 新写 | driver：标记为 complex 的 gap 走 multi-turn loop；订阅 Stop hook → 判 continue/stop（max-turn cap、自报完成关键词、stagnation 探测） |
| `daemon/src/orchestrator/complexity.ts` | 新写 | gap 复杂度判定：heuristic（触及文件数 / vision 关键词 / 历史失败次数）+ 用户手动 override |
| `daemon/src/storage/migrations/006-cc-sessions.ts` | 新写 | `cc_sessions` 表 + `gaps.complexity` 字段 + `cc_turn_events` 表 |
| `daemon/src/routes/stream.ts` | 新写 | SSE endpoint `/api/runs/:runId/cc-stream` |
| `daemon/src/storage/scratchpad.ts` | 借 Cairn `scratchpad` 模型 | implementer 跨 turn 写 progress note；reviewer 读；scoped 到 run_id |

### B. 改文件

| 文件 | 改什么 |
|---|---|
| `daemon/src/engines/factory.ts` + `router.ts` | role=implementer && gap.complexity=complex → 路由到 stream engine；其他保持 ClaudeCliEngine |
| `daemon/src/orchestrator/controller.ts` | 在 differ 输出 gap 后调 `complexity.ts` 打标；merge multi-turn driver 进 controller 主流程 |
| `daemon/src/orchestrator/loop.ts` | reviewer 触发点改：implementer 自报完成（multi-turn 结束）后跑一次（不是每 turn 跑） |
| `daemon/src/storage/queries.ts` | 加 cc_sessions / cc_turn_events / gap.complexity 查询 |
| `ui/src/pages/Workspace.tsx`（或对应） | 订阅 SSE，显示 multi-turn 进度条 + 当前 turn + token 累计 |

### C. 测试 + smoke（同 commit）

| 文件 | 类型 |
|---|---|
| `daemon/src/engines/claude-stream.test.ts` | unit：fake child + 模拟 NDJSON 流 |
| `daemon/src/engines/claude-hooks.test.ts` | unit：settings.json 内容断言 |
| `daemon/src/state/cc-session-store.test.ts` | unit：persist + lookup |
| `daemon/src/orchestrator/multi-turn.test.ts` | unit：driver 逻辑、stop 条件 |
| `daemon/src/orchestrator/complexity.test.ts` | unit：heuristic |
| `daemon/src/storage/scratchpad.test.ts` | unit |
| `scripts/smoke-multi-turn.mjs` | smoke：fake-claude 3-turn + Stop hook + resume + scratchpad write/read |
| `ui/tests-e2e/multi-turn.spec.ts` | Playwright e2e：UI 进度条显示 |
| `ui/src/pages/Workspace.test.tsx` | jsdom：SSE mock + 进度条渲染 |

---

## Expected Outputs（artifacts 落地清单）

完成后下列文件物理存在：
- 9 个新源文件（daemon 7 + routes 1 + storage 1）
- 1 个新 migration（006-cc-sessions.ts），schema_migrations 表多 1 行
- 6 个新 unit test 文件 + 1 个新 smoke 脚本 + 2 个新 UI 测试
- `gaps` 表多 1 字段 `complexity TEXT NOT NULL DEFAULT 'simple'`
- `cc_sessions` 表存在（run_id PK, role, cc_session_id, last_turn_idx, created_at）
- `cc_turn_events` 表存在（run_id, turn_idx, source, payload_json, ts）
- 1 个 PR + 至少 5 个 conventional commits（按类分：feat:engines / feat:storage / feat:orchestrator / feat:routes / test:smoke / docs：plan-followup）

---

## How To Verify

### Gate 1 — 单测
```bash
cd D:/lll/d2p/daemon && npm test
cd D:/lll/d2p/ui && npm test
```
全绿 ≥ 71（原） + 新增 ≥ 30 testcase。

### Gate 2 — 已有 smoke 不回归
```bash
node scripts/smoke-walking-skeleton.mjs
```
仍然 PASS（simple gap 路径不变）。

### Gate 3 — 新增 smoke
```bash
node scripts/smoke-multi-turn.mjs
```
fake-claude 模拟 3-turn implementer，断言：
- 3 个 Stop hook 事件
- cc_session_id 持久化
- scratchpad 累计 3 条 note
- reviewer 仅在 turn 3 后被调一次
- 中断 + 重启时 `--resume <session_id>` 被注入

### Gate 4 — 真 cc 手 smoke
准备一个 fixture demo（写一个故意需要 2-3 turn 才搞定的 bug），mark complexity=complex，跑：
```bash
d2p start
# UI 启动 → 选 fixture demo → 看 Workspace 页 multi-turn 进度
```
断言：UI 显示 turn 1/2/3，token 实时累计，reviewer 在最后跑一次，merge 进 main。

---

## Probes (FEATURE-VALIDATION 1+2+3 跨引擎硬匹配)

对 `scripts/smoke-multi-turn.mjs` 的 expected behavior 做三方核对：

| Gate | 工具 | 输出 |
|---|---|---|
| 1 | `claude --model haiku -p "given fake-cc emits 3 stop hooks with session_id=abc and no result-event, what should smoke-multi-turn.mjs assert? canonical JSON {turn_count:int, session_persisted:bool, scratchpad_notes:int, reviewer_calls:int, resume_arg_seen:bool}"` | JSON |
| 2 | Agent subagent (general-purpose, fresh context) | 同 schema JSON |
| 3 | 实跑 `node scripts/smoke-multi-turn.mjs --report-json` | 真实输出 |

`jq -S` 后三方 byte-identical 才 ship。1≠2 → prompt 歧义或幻觉；1+2 一致但 ≠ 3 → 改 smoke 实现，不动 prompt。

---

## 不做什么（防漂移清单）

- ❌ 不搬 `mode-a-loop` / `mode-a-spawner` —— 那是 Cairn 的 Mentor 自治 loop，定位归 Pace
- ❌ 不搬 Scout CC / Lead-CC / `managed-loop-*` —— mentor framing 不进 d2p
- ❌ 不搬 `harness-budget` / `harness-pool` / `harness-gc` —— d2p 已有 F6 budget + F3 health
- ❌ 不搬 Cairn 8 表全套 —— 仅借 scratchpad 单表概念
- ❌ 不引新 npm runtime dep（hooks / stream-json 全部 node 内置 + 已有 spawn）
- ❌ 不改产品定位文档（CLAUDE.md / README.md / DEV-DOC.md 主文）
- ❌ 不动 GitHub PR 模式 / 多 LLM engine path
- ❌ 不在主 checkout 干活 —— lead 进 `.worktrees/__lead__`，每个 task worker 各自 worktree
- ❌ 不 `git push --force` / `--no-verify`

---

## Execution 路径（开干顺序）— **UI 优先 / mock 驱动**

用户偏好：先用 mock 数据把 UI/UX 跑通到满意，再补真实后端。
按 6 个 commit batch，**UI 在前**：

1. **feat(ui)**: Workspace multi-turn 进度条 UI + 假 SSE 流（mock 数据：turn 进度、token 累计、scratchpad 滚动、complex/simple 模式切换、自治进行中/暂停/完成态）+ jsdom + Playwright e2e。**这一步走通到用户验收 UI 满意**，才进下一 batch
2. **feat(storage)**: migration 006 + scratchpad.ts + cc-session-store.ts + 单测
3. **feat(engines)**: claude-stream.ts + claude-hooks.ts + claude-mcp-cfg.ts + 单测
4. **feat(orchestrator)**: complexity.ts + multi-turn.ts driver + 单测
5. **feat(orchestrator+routes)**: controller.ts / loop.ts wire-in + factory/router 路由 + 真 SSE endpoint 替换 mock
6. **test(smoke)**: smoke-multi-turn.mjs + 真 cc 手 smoke 记录 + plan-followup 文档

按 CLAUDE.md：lead 进 `.worktrees/__lead__`，每 commit batch 完成跑该层验证再继续。三方 probe 在 batch 6 之后跑。

---

## 风险 + 缓解

| 风险 | 缓解 |
|---|---|
| Cairn `.cjs` 文件用 CommonJS + better-sqlite3 直连，d2p 是 ESM TS | TS 重写，不直接复制；引用 Cairn 实现仅作参考 |
| stream-json 在 Windows 双引号 / shell 转义坑（Cairn 踩过：commit `302e97d`） | 沿用 Cairn 的「单引号 JS 路径」修法；smoke 覆盖 |
| Multi-turn 撞 d2p 现有 600s implementer timeout | multi-turn 走独立 timeout（per-turn 600s + 整任务 cap **21600s / 6h**）；不动 ROLE_TIMEOUTS_MS |
| reviewer 在 multi-turn 模式下何时跑 | 仅在 implementer 自报完成（Stop hook with `stop_hook_active=false` 且没有 continue 关键词）后跑一次 |
| `--resume` session_id 在 cc CLI 不同版本行为差异 | 已知 Cairn 验证过 2.x；smoke 里 probe `claude --version` 兜底 |
| gap 复杂度判错（simple 误判 complex / 反之） | 用户可在 UI 上手动 override；heuristic 保守（默认 simple，只有触发明确条件才升 complex） |

---

## Out of scope（搬完之后的可能 follow-up，本 plan 不做）

- cross-engine multi-turn（openai-compat / anthropic-api 的 multi-turn 接力 —— 它们走 chat-completion，模型不同，独立设计）
- multi-turn 内部 reviewer 介入（每 turn 跑 reviewer 然后 feed back 给 cc）—— 当前定为 follow-up
- Pace 的 mentor / Scout / Lead-CC —— 完全不在 d2p
