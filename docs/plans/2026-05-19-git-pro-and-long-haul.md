# 4 大 git-pro 增强 + 长程任务：让 d2p 真像程序员管仓库

> 4 个核心 feature 并行做：
> 1. **Commit diff drawer** — 改了什么（文件 tree + hunk 级 diff）
> 2. **AI Risk Score + 需人看标记** — 哪里该 review
> 3. **Core-paths 警告** — 动了核心代码必须用户点头
> 4. **跨 session 恢复 + Milestone** — 长程任务进度持续可见
>
> 试验场：`D:\lll\managed-projects\agent-game-platform`（真 Next.js + Bun + 已有 GitHub
> remote `anzy-renlab-ai/agent-game-platform`）。mock 数据必须用试验场真路径 +
> 真 git log，**不准用 D:\demos\notes-saas 这种假路径**。

**Scope source**：用户 2026-05-19：
- 4 个 feature 全做（不删）
- 「能做的功能都做，可以未来化」
- 「真能在 github 试验场仓库看到相关的修改 — 真实性的内容」
- 「UI 以及交互都要体验够好」

---

## Acceptance checklist

1. **真实数据**：mock 数据全部从 `D:/lll/managed-projects/agent-game-platform` 真 git log + 真文件结构读出来，不写假路径假文件名
2. **4 feature mockup 全可点**：每个 preview 路径 + Workspace 集成视图（demoMode 下能看完整 flow）
3. **真后端**：daemon 暴露 4 个新 API；至少一条 end-to-end 跑通真试验场（commit diff 真读 git；risk score 真算）
4. **试验场可见**：跑完后 GitHub 仓库能看到 d2p 的真 commit（或至少 push 到一个 feat/d2p-demo 分支）
5. **UI 交互**：所有动效、状态切换、空态、错误态都精致；不喧宾夺主
6. **测试**：daemon vitest + ui vitest + Playwright e2e + tsc 全绿

---

## Plan — 具体改什么

### Worker A — daemon 后端（sonnet，worktree `.worktrees/git-pro-backend`）

**写集**：

1. **`daemon/src/git/diff.ts`** (新) — `parseDiff(worktreeRoot, fromSha, toSha): FileDiff[]`；shell-out git diff + 解析 patch 格式 → 结构化 `{path, status, insertions, deletions, hunks: Hunk[]}`，每个 Hunk `{header, oldStart, oldLines, newStart, newLines, lines: DiffLine[]}`。处理 binary / rename。
2. **`daemon/src/git/diff.test.ts`** — fixture repo 跑真 diff，断言解析
3. **`daemon/src/routes/commits.ts`** (扩) — `GET /api/commits/:sha/diff` 返 `{ files: FileDiff[] }`
4. **`daemon/src/risk/score.ts`** (新) — AI risk score：输入 commit diff，输出 `{ band: 'low'|'mid'|'high', score: 0-1, reasons: string[], reviewHunks: { path: string; hunkIdx: number; reason: string }[] }`。规则基础 + LLM 判定（用 haiku 快判）：动了 auth/db/migrations/CI/config → 至少 mid；>50 行删除 → mid；无 test cover → mid；动了 core-paths → high
5. **`daemon/src/storage/migrations/007-risk-and-milestones.ts`** (新) — 加 `commit_risk` 表（sha, band, score, reasons_json, review_hunks_json, ts）+ `milestones` 表（id, session_id, title, vision_excerpt, preset_item_ids_json, status, ordinal, completed_at）+ `session_resume_marks`（session_id, last_seen_ts, gap_id_at_pause, run_id_at_pause）
6. **`daemon/src/storage/queries.ts`** (扩) — `setCommitRisk` / `getCommitRisk` / `listMilestones(sessionId)` / `upsertMilestone` / `markSessionPause(sessionId, gapId, runId)` / `loadResumeMark`
7. **`daemon/src/routes/risk.ts`** (新) — `POST /api/commits/:sha/risk/score`（按需触发 AI 算）+ `GET /api/commits/:sha/risk`
8. **`daemon/src/routes/milestones.ts`** (新) — `GET /api/milestones` / `POST /api/milestones`（从 vision + preset 自动拆 milestone）/ `PATCH /api/milestones/:id`
9. **`daemon/src/core-paths/loader.ts`** (新) — 读项目 `.d2p/core-paths.yaml`（用户配置 glob）+ AI fallback（按 import 频次推断，调 haiku 一次缓存到 `.d2p/core-paths.inferred.json`）
10. **`daemon/src/core-paths/checker.ts`** (新) — `checkChangedFiles(changedPaths: string[], corePathGlobs: string[]): { hits: string[]; matchedGlob: Record<string,string> }`
11. **`daemon/src/routes/core-paths.ts`** (新) — `GET /api/core-paths`（list config + 是否 AI inferred）+ `POST /api/core-paths/check`（传 changedPaths 返 hits）
12. **`daemon/src/server.ts`** (改) — 注册 4 新 routes
13. **`daemon/src/recovery/startup.ts`** (改) — 启动时读 `session_resume_marks`，找最新 pause 点；如果有 gap-in-progress 但 daemon 重启，更新事件 `SESSION_RESUMED` 通知 UI
14. **测试**：每个新模块 vitest 单测（diff parse / risk score 规则 / core-paths checker / milestones CRUD / resume mark）

**不动**：UI 文件。

### Worker B — UI 4 个 feature mockup（sonnet，worktree `.worktrees/git-pro-ui`）

**写集**：

1. **`ui/src/mock/agentGamePlatform.ts`** (新) — 用 `D:/lll/managed-projects/agent-game-platform` 的真 git log + 真文件结构生成 mockProjects[0]、mockCommits[]、mockGaps[]、mockSessions。读取（由 worker B 在 worktree 内 spawn git 命令拿到真数据，写死成 const）。**绝不写 D:\\demos\\notes-saas 这种假路径**。
2. **`ui/src/mock/diff.ts`** (新) — 几个真实 patch 样本（取自试验场 commit 4944fba / 22a7654 等），多文件、多 hunk、新增/修改/重命名
3. **`ui/src/mock/risk.ts`** (新) — 试验场 commits 的 risk score canned 数据
4. **`ui/src/mock/milestones.ts`** (新) — agent-game-platform vision 拆 5-6 个 milestone（Lobby / Watch / Agents / Social / Polish / Ship）
5. **`ui/src/mock/corePaths.ts`** (新) — 试验场 core paths：`lib/db/**`、`app/api/auth/**`、`bunfig.toml`、`Dockerfile`、`lib/payments/**`、`prompts/**`
6. **`ui/src/components/CommitDiffDrawer.tsx`** (新) — 点 commit 卡片"看 diff"打开抽屉：左侧文件 tree（带 +/- 行数 + 状态 icon），右侧 hunk-level diff 高亮（unified view，addition 绿底，deletion 红底，行号双列），顶部 file path + binary 兜底
7. **`ui/src/components/RiskBadge.tsx`** (新) — 在 commit 卡片右上显示 low/mid/high chip + 鼠标 hover 看 reasons + 高 risk 时整张 commit 卡片描红边
8. **`ui/src/components/ReviewHintBanner.tsx`** (新) — drawer 顶部条 "建议你看一眼这 N 处" + 跳转到具体 hunk
9. **`ui/src/components/CorePathsAlert.tsx`** (新) — modal：implementer commit 前如果命中 core-paths，弹出 "动了 N 处核心代码，需要你确认"，列出 hit paths + matched glob + diff 预览 + [允许 / 否决] 按钮；演示模式 demo 一次
10. **`ui/src/components/CorePathsConfigEditor.tsx`** (新) — `.d2p/core-paths.yaml` 编辑器（glob 列表 + AI 推断的 chip + 添加 / 删除 / 标记 "user-pinned"）
11. **`ui/src/components/MilestonesPanel.tsx`** (新) — vision milestone 进度条（5-6 个 milestone 横向，每个含 % 完成 + 当前进行中的 gap 数）+ 折叠看 detail
12. **`ui/src/components/SessionResumeBanner.tsx`** (新) — 打开 d2p 时如果检测到上次未完成的 session/gap，顶部 banner "上次你在 X gap 中断，要继续吗？" + [继续] [放弃] 按钮
13. **`ui/src/components/CommitsTimeline.tsx`** (扩) — 嵌入 RiskBadge；加 "看 diff" 触发 CommitDiffDrawer
14. **`ui/src/components/StatusStrip.tsx`** (扩) — 加 milestone KPI（"3 / 6 milestone"）+ 点开看 MilestonesPanel drawer
15. **`ui/src/components/SessionsBoard.tsx`** 或 Workspace (扩) — 顶部加 SessionResumeBanner
16. **`ui/src/preview/Preview.tsx`** (扩) — 加 preview 路径：`?preview=git-pro/diff` / `risk` / `core-paths` / `milestones` / `resume`
17. **`ui/src/preview/PreviewIndex.tsx`** (扩) — 加 "Git pro + 长程任务" section
18. **`ui/src/components/ProjectsHome.tsx`** (改) — mockProjects 替换成 agent-game-platform 真数据为主 project
19. **`ui/src/components/CommitsTimeline.tsx`** 真数据 mock：用 agent-game-platform 真 commit
20. **测试**：每组件 jsdom + Playwright e2e（preview 路径全覆盖）

**不动**：daemon。

### Lead — 整合 + 真试验场跑通（我，主 checkout）

1. 拼合 worker A + worker B：UI 组件接 worker A 的 API（PreviewIndex 仍走 mock，但 Workspace 真模式接真 API）
2. 在试验场 `D:/lll/managed-projects/agent-game-platform` 跑真 d2p loop（最低限度）：
   - `d2p start` daemon
   - 选 agent-game-platform 为 demo
   - vision 用真 README + 现有 commits 推断
   - 跑 1 个 gap（比如"补 vision.md"或"加 README quickstart"）→ 真 commit → 推 fix/d2p-demo 分支 → GitHub 上可见
3. 截图试验场 GitHub commit 入 docs/screenshots/git-pro-trial.md
4. plan-followup：本 plan 收尾
5. commit + push

## Expected Outputs

完成后：
- daemon：3 个新 module（diff / risk / core-paths）+ 1 migration 007 + 4 个新 route + queries 扩展 + 4 个 vitest
- ui：8 个新组件 + 5 个新 mock 文件（含真试验场数据）+ preview 扩展 + 5 个 jsdom + 4 个 Playwright e2e
- 试验场 GitHub 仓库可见真 d2p 跑过的 commit（至少 push 到 feat/d2p-demo）
- 3 个新 commit batch（worker A / worker B / lead）

## How To Verify

```bash
cd daemon && npx vitest run    # 236 → 236+N 全绿
cd ui && npx vitest run         # 69 → 69+M 全绿
cd ui && npx playwright test    # 全部绿
node scripts/smoke-multi-turn.mjs   # 不回归
```

试验场跑通后访问 `https://github.com/anzy-renlab-ai/agent-game-platform/commits/feat/d2p-demo` 看真 commit。

## Probes (FEATURE-VALIDATION 1+2+3)

对 `GET /api/commits/:sha/diff` 返回 shape 跨引擎核对：

```
1 haiku probe: "given git diff output with 2 files / 3 hunks, what is the expected /api/commits/:sha/diff JSON shape?" → JSON
2 sonnet subagent fresh context: 同问 → JSON
3 实跑: curl /api/commits/<真 sha>/diff → 真实输出
```
三方 byte-identical 才 ship。

## 不做什么

- ❌ 不引 react-syntax-highlighter / react-diff-view 等大重量动画库（diff 高亮纯 CSS + 我们自己 tokenize）
- ❌ 不真 push 主 main 到试验场（用 feat/d2p-demo 分支）
- ❌ 不改试验场的 CLAUDE.md / 产品定位文件
- ❌ Worker A 不动 UI；Worker B 不动 daemon
- ❌ 动画不浮夸：drawer 滑入 ≤300ms / risk 高时 ring 静态不闪烁
- ❌ 不 force push / 不 --no-verify

## Execution

1. lead：起 2 worktree + .gitignore（已 ignore .worktrees）
2. dispatch worker A + worker B 同时跑
3. lead 同时改 mock 真实化 + plan-followup 准备
4. 两 worker 完后 lead merge + 试验场真跑 + push
5. 推 origin main
