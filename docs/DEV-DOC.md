# ZeroU — Development Document

> 完整开发文档。新开发会话先读这一份，再按需翻 `docs/details/` 看每个组件的可直接抄实现细节。
> Companion: `CLAUDE.md`（工作流规则 + 项目坐标）/ `docs/plans/`（具体 PR 计划）/ `docs/details/`（细节文档 10 份）。
> 锁日：2026-05-12（12 轮 grill 结论）。原代号 d2p（仓库、CLI 命令、内部代号沿用 d2p）。
> Status: **DRAFT v2**——产品决策已锁，技术细节已展开到 `docs/details/`，未尽事项见 §10。

## 细节文档索引

详 `docs/details/README.md`。各文档与本 overview 的对应：

| # | 细节文档 | 对应本文 §|
|---|---|---|
| 01 | `details/01-prompts.md` | §3.3 数据流、§4.5/4.8/4.9/4.10/4.12 中各 agent 调用 |
| 02 | `details/02-types.md` | §4 全部组件的输入/输出类型 |
| 03 | `details/03-storage.md` | §4.4 |
| 04 | `details/04-api-contracts.md` | §4.1 endpoints |
| 05 | `details/05-subprocess.md` | §3.1 子进程模型、§4.1 subproc 封装 |
| 06 | `details/06-state-machines.md` | §7.1 |
| 07 | `details/07-presets.md` | §4.7 + §6 |
| 08 | `details/08-ui-cli-spec.md` | §4.2 + §4.3 |
| 09 | `details/09-config-files.md` | 跨 §4.4 / §4.7 / §10 |
| 10 | `details/10-build-test-order.md` | §8 phasing 的可执行版本 |

---

## §0. Product Lock (1-page summary)

| 维度 | 锁 |
|---|---|
| 一句话定位 | demo→product 转化引擎：用户给本地 demo + vision，d2p 自动派 agent 把它推到 product 成熟度 |
| 形态 | **Web 应用（localhost）+ 独立 daemon**；浏览器 UI 只是观察口，关页面不停作业 |
| 平台 | 桌面 Win/Mac（通过浏览器交互）；mobile 不做 |
| 多人 | MVP 单机单人 self-dogfood，目标 1 个月跑通；后期面向 <10 人小团队 |
| 后端 | 纯本地 SQLite；暂不跨机同步 |
| AI 引擎 | **不持 API key**，全部走 `claude --model X -p` CLI 子进程（消费用户 Claude Code 订阅额度） |
| Demo 输入 | 任意 folder，d2p 自动 `git init` + initial commit |
| Vision 来源 | d2p 多轮对话 elicit 用户，存为 markdown |
| Gap 检测 | preset（按项目类型）+ vision 叠加；AI 看仓库推 preset，用户确认 |
| Approval gate | 无——用户不审 diff，trust agent + reviewer pipeline |
| Loop trigger | 自动启动 → fix → re-diff → 循环；随时可点停 |
| 并发 | 默认 1（串行），后期可调 |
| Done | preset 全打勾 + Claude 看 vision 说 yes，双绿才停 |
| 失败处理 | reviewer agent 决定 retry / rollback / skip / escalate |
| Branch 模型 | 仓外 `.d2p-worktrees/`，每 fix 一 `fix/<slug>` 分支，d2p 自动 merge 回 main |
| 项目类型识别 | AI 看仓库推 preset，用户点对/换；类型集开放，不预设语言限制 |
| Run log 颗粒 | 里程碑事件 + 每个 agent 一句 thought summary；详情可折叠展开 |
| Cost | MVP 不设 cap，仅记录消耗（如 cc CLI 暴露） |
| Daemon 寿命 | MVP-0 一体进程（npm run dev 顶起）；后期装系统服务 |
| 不做什么 | chat IM / 任务看板 / Cairn 替代 / IDE / Cursor clone / multi-agent framework / 直调 Anthropic SDK / 多 demo 并行 |

---

## §1. Definition

### 1.1 What d2p is

**d2p (demo → product)** 是把"原型/玩具/demo"批量加工成"产品级软件"的本地工具。
工作方式：用户给 d2p 一个 demo 代码仓库 + 一段自然语言 vision，d2p 自动识别"缺哪些 product 必备肌肉"，调度 Claude Code agent 把缺的补上，自动 commit/merge，直到 preset 清单全绿 + Claude 判定 vision 已满足。

### 1.2 What d2p is **not**

- 不是 chat IM / Slack / 飞书
- 不是 Linear / Jira / Notion 任务看板
- 不是 Cairn 替代或 fork（Cairn = project control surface 观测层；d2p = 主动转化引擎，互补不重叠）
- 不是 IDE / 不是 Cursor / Codex / Aider clone
- 不是通用 multi-agent framework（不卖底层；只为 demo→product 这一个目标编排）
- 不直接调 Anthropic API（不持 key，全靠 cc CLI）
- 不做多 demo 并行（一个进程一次只服务一个 demo）
- 不做跨机同步 / 不做云部署 / 不做 mobile

### 1.3 Done 判据

```
done(d2p_session) := preset_checklist.all_green AND vision_evaluator.verdict == YES
```

两个条件**同时**满足才停 loop。任一未达 → 继续生成下一批 gap → 继续 fix。
用户可随时主动 pause（不算 done，但暂停 loop）。

---

## §2. User Journey

### 2.1 First-run

1. 用户跑 `d2p start`（MVP-0 = `npm run dev`，MVP-1+ = 系统服务）
2. 浏览器开 `http://localhost:5173`
3. UI 提示「选 demo folder」。用户给路径 `D:\demos\my-saas-demo`
4. d2p 自动 `git init`（若无 `.git`）+ initial commit
5. **Type detection**：d2p 起一个 `claude -p` 看仓库（package.json / 入口文件 / README / 主要目录），输出 `{type: "saas-web", confidence: 0.84, evidence: [...]}`；UI 显示「这看起来是 SaaS Web 应用，对吗？」+ 改类型按钮
6. **Vision elicitation**：用户确认 type 后，d2p 启 grilling round（≤5 轮、每轮 ≤3 题 A/B/C/free 选项），话题含目标用户、核心场景、商业模式、关键 KPI、明确不做。每轮答案累积成 markdown，最终存 `<demo>/.d2p/vision.md`
7. **Initial diff**：d2p 派 differ agent 看 vision + preset + 代码现状，输出 gap 列表（带 severity / category / suggested approach）
8. UI 显示 gap 列表，用户点「Start loop」（或先单独勾选某些跳过）
9. d2p 进入 loop 模式：一次处理一个 gap → implement → review → commit → merge → re-diff
10. Live Run Log 实时显示事件 + 每个 agent 的 thought summary
11. 终止条件：
    - 双绿 → UI 显「✅ Product ready」+ summary
    - 用户点 Pause → loop 冻结，状态留 SQLite
    - Reviewer 多次 ESCALATE 在同一 gap 后 → UI 显「Need human」徽标，loop 继续别的 gap

### 2.2 Resume

- 浏览器关闭：daemon 不停，loop 不停。再开浏览器，UI 重 sub SSE 流，从 SQLite 读出 `current_session_id` + 进度
- 用户点 Pause：loop 冻结；UI 上 Resume 按钮重启循环
- 机器重启：MVP-0 daemon 没了，要 `d2p start`；MVP-1+ 装系统服务自动起，loop 状态 SQLite 持久化 → 自动 resume 上次未完工作

### 2.3 Session 终止

用户点「End session」→ d2p 生成 `<demo>/.d2p/session-summary.md`（含跑了哪些 fix / 多少 commits / preset 状态 / 用了多少 token）+ 关闭 session 记录。

---

## §3. System Architecture

### 3.1 Process model

```
┌────────────────────────┐
│  Browser UI            │
│  Vite + React          │
│  http://localhost:5173 │
└───────────┬────────────┘
            │ HTTP POST / SSE
            ▼
┌────────────────────────┐         ┌──────────────────────┐
│  d2p Daemon            │         │  SQLite              │
│  Hono on Node 24       │ ◄─────► │  ~/.d2p/state.db     │
│  http://localhost:5174 │         │  + per-demo .d2p/    │
└──────┬─────────┬───────┘         └──────────────────────┘
       │ spawn   │ spawn
       ▼         ▼
┌─────────────┐ ┌──────────────────────────────┐
│ claude -p   │ │ git CLI (worktree / commit / │
│ (workers,   │ │  merge / status)             │
│  reviewers, │ └──────────────────────────────┘
│  probes)    │
└─────────────┘
```

- **Daemon 进程**：Node 24 + Hono web server。承担调度、状态管理、子进程拉起、SSE 推送
- **UI 进程**：浏览器内 Vite-served React app。纯展示 + 用户输入路由给 daemon
- **Worker 子进程**：`claude --model X -p "..."` 一次性拉起，结束即销毁。每个 worker 对应一个 gap/fix/review 步骤
- **Git CLI 子进程**：daemon spawn `git`，不用 JS git 库（少依赖、行为可预测）

### 3.2 Process boundaries

| 边界 | 谁负责 |
|---|---|
| 用户输入 | Browser UI → POST /api/* → Daemon |
| 状态变更 | Daemon → SQLite（事务） |
| AI 调用 | Daemon spawn `claude -p` → stdout JSON → 解析 |
| Git 操作 | Daemon spawn `git` → exit code + stdout |
| 文件读写 | Worker（cc）在 worktree 内自由读写；Daemon 只在 worktree 外做 metadata |
| 推送给 UI | Daemon SSE `/api/events/stream` → Browser EventSource |

### 3.3 Data flow（一次 loop iteration）

```
[Loop start]
   ↓
Differ agent (claude -p) 看 (vision + preset + repo state) → 输出 gap list
   ↓
Daemon 写 gap_queue 入 SQLite
   ↓
取队头 gap → 起 worktree `.d2p-worktrees/fix-<slug>` (off main)
   ↓
Implementer agent (claude -p in worktree) → 写代码 + commit
   ↓
Static Gate（非 AI）：跑 `npm test` / `tsc --noEmit` / 项目自定义命令
   ↓ 绿
Alignment Probe (claude --model haiku -p) → JSON {alignment: 0-1}
   ↓ ≥ 0.7
Behavioral Reviewer (claude --model sonnet -p, fresh) → verdict JSON
   ↓ APPROVE
[高敏 gap only] Adversarial Reviewer (sonnet) → 尝试破坏 fix
   ↓ 未破坏
Daemon merge fix branch → main，删 worktree
   ↓
Re-evaluate done condition (preset + vision dual-check)
   ↓ 未双绿
[Loop continues]
```

任意一步失败 → 进 retry / rollback / skip / escalate 决策树（详 §5）。

---

## §4. Component Specs

### 4.1 Daemon (`daemon/`)

- **Stack**：Node 24 + TypeScript（NodeNext 模块）+ Hono + better-sqlite3 ^12.9.0
- **Entry**：`daemon/src/server.ts`
- **Port**：默认 5174，可 env `D2P_DAEMON_PORT` 改
- **Endpoints**：
  - `POST /api/session/start` { demo_path } → 新建/恢复 session
  - `GET  /api/session/current` → 当前 session 状态
  - `POST /api/vision/answer` { question_id, answer } → vision elicit 应答
  - `POST /api/vision/finalize` → 锁定 vision
  - `POST /api/loop/start` → 起 loop
  - `POST /api/loop/pause` → 暂停
  - `POST /api/loop/resume` → 继续
  - `POST /api/loop/end` → 结束 session
  - `GET  /api/gaps` → 当前 gap 列表
  - `POST /api/gaps/:id/skip` → 跳过某 gap
  - `GET  /api/log/stream` → SSE，推 LogEvent
  - `GET  /api/preset/current` / `POST /api/preset/override`
- **Subprocess 管理**：所有 `claude` / `git` 调用过 `daemon/src/subproc/spawn.ts` 单一出口（统一日志、错误处理、token 提取）
- **生命周期**：
  - MVP-0：`npm run dev` 启 daemon + Vite UI 一体
  - MVP-1+：拆出 daemon 进程，装为：
    - Windows：NSSM 包装 + Windows Service
    - macOS：launchd plist
    - Linux：systemd unit
    - 提供 `d2p install-service` / `d2p uninstall-service` CLI

### 4.2 Web UI (`ui/`)

- **Stack**：Vite + React 18 + TypeScript + Tailwind + shadcn/ui
- **Entry**：`ui/index.html` → `ui/src/main.tsx`
- **Pages / Panels**：
  - `Landing` — 选 folder 或恢复 session
  - `Setup` — type confirm + vision elicit 多轮对话
  - `Workspace` — 主面板，三栏：
    - 左：当前 gap 队列（排序、状态徽标）
    - 中：Live Run Log（事件流 + thought summary，可折叠看 stdout）
    - 右：Vision 摘要 + preset 进度条 + cost 计数
  - `Done` — 双绿后总结页 + session-summary.md 预览
- **状态管理**：Zustand store 接 SSE，单向数据流
- **跨页持久**：SQLite 真相源；UI 重连时 daemon 推完整快照
- **i18n**：MVP 中文为主，键值化，后期可加英文

### 4.3 CLI (`cli/`)

- **Stack**：Node 24 + commander
- **Entry**：`bin/d2p` (npm bin)
- **Commands**：
  - `d2p start` — 起 daemon + UI（MVP-0），或 ensure daemon 在跑（MVP-1+）
  - `d2p stop` — 停 daemon
  - `d2p status` — 显当前 session、loop 状态、cost
  - `d2p open` — 浏览器开 UI
  - `d2p doctor` — 检查 cc 是否安装可用、git 可用、SQLite 写权限
  - `d2p install-service` / `d2p uninstall-service`（MVP-1+）

### 4.4 Storage (`daemon/src/storage/`)

- **DB 位置**：`~/.d2p/state.db`（全局 session 索引 + 跨 demo 元数据）
- **Per-demo 目录**：`<demo>/.d2p/`（vision.md, session-summary.md, gap-history.json, preset-overrides.yaml）
- **`.d2p-worktrees/`**：仓外 worktree 容器（`<demo-parent>/.d2p-worktrees/<demo-name>-fix-<slug>/`）

**Migrations**（`storage/migrations/`，按 version 顺序，禁改已落地）：

```
001-init.ts:
  sessions, demos, vision_drafts, gaps, fixes, reviews, log_events, runs
002-presets.ts:
  preset_overrides
003-cost.ts:
  cost_records
```

**核心表**（关键列）：

```sql
sessions (id PK, demo_id FK, started_at, ended_at NULL,
          status TEXT CHECK (status IN ('SETUP','LOOPING','PAUSED','DONE','ENDED')),
          vision_md_path TEXT, preset_type TEXT);

demos    (id PK, path TEXT UNIQUE, first_seen_at, last_session_at,
          inferred_type TEXT);

gaps     (id PK, session_id FK, slug TEXT UNIQUE WITHIN session,
          title TEXT, body_md TEXT, category TEXT, severity TEXT,
          source TEXT CHECK (source IN ('preset','vision','both')),
          status TEXT CHECK (status IN ('PENDING','IN_PROGRESS','DONE','SKIPPED','NEED_HUMAN')),
          dynamic_k INTEGER, created_at, finished_at NULL);

fixes    (id PK, gap_id FK, attempt INTEGER, branch TEXT,
          worktree_path TEXT, commit_sha TEXT NULL,
          static_gate_passed BOOLEAN, alignment_score REAL,
          reviewer_verdict TEXT, status TEXT,
          stderr_excerpt TEXT, created_at, finished_at);

reviews  (id PK, fix_id FK, kind TEXT CHECK (kind IN ('alignment','behavioral','adversarial')),
          model TEXT, verdict TEXT, hints_json TEXT,
          reason_code TEXT, raw_json TEXT, created_at);

log_events (id PK, session_id FK, ts INTEGER, level TEXT,
            kind TEXT, payload_json TEXT);

cost_records (id PK, session_id FK, kind TEXT, model TEXT,
              input_tokens INTEGER, output_tokens INTEGER, ts INTEGER);
```

### 4.5 Vision Elicitor (`daemon/src/vision/`)

- 走多轮 grill 模式，每轮 d2p 内嵌一个 `claude -p` 子调用生成下一组问题
- 输入：当前已收集的 vision 片段 + repo 浅扫摘要 + 上一轮答案
- 输出：JSON `{questions: [{id, question, options: [{label, description}]}], done: false}` 或 `{done: true, vision_md: "..."}`
- 最多 5 轮，每轮 ≤3 题（与 Cairn GRILL.md 一致）
- 用户答案累积到 `vision_drafts`，finalize 时 d2p 起一个 sonnet 把所有片段熔成 `<demo>/.d2p/vision.md`（markdown，含标题 / 目标用户 / 核心场景 / KPI / 不做什么）

### 4.6 Project Detector (`daemon/src/detector/`)

- 启动时 daemon 调 `claude --model haiku -p`，prompt 含：
  - 目录 tree（深度 ≤3，过滤 node_modules / .git / dist 等）
  - 关键 manifest 文件（package.json / Cargo.toml / pyproject.toml / go.mod / etc.）头 50 行
  - README 头 100 行（若有）
- 期望输出 JSON：

```json
{
  "type": "saas-web | static-site | cli-tool | library | api-service | ml-script | mobile | desktop-app | unknown",
  "confidence": 0.84,
  "evidence": ["next.config.ts present", "stripe/* deps in package.json", "src/app/page.tsx exists"],
  "preset_candidates": ["saas-web", "api-service"]
}
```

- UI 显结果 + 用户可点「换」选别的 preset
- **类型集开放**：不在内置 preset 库里的 type 时，user 输入自定义 type 名 → d2p fallback "vision-only" 模式（无 baseline preset，全靠 vision 推 gap）

### 4.7 Preset Library (`presets/`)

- 文件格式：markdown checklist + frontmatter
- 位置：`presets/<type>.md`
- 例 `presets/saas-web.md`：

```markdown
---
type: saas-web
name: SaaS Web Application
version: 1
---

# SaaS Web App Preset

## Identity & Auth
- [ ] auth-signup: 用户能注册/登录（邮件密码或 SSO）
- [ ] auth-session: session 安全（HttpOnly cookie / CSRF / 过期）
- [ ] auth-recovery: 忘记密码 / 邮箱验证

## Data Persistence
- [ ] db-real: 持久层不是 in-memory / mock；schema 可迁移
- [ ] db-migrations: 有 migration 机制 + 不可回退保护
- [ ] db-backup-path: 备份/导出路径（至少一种）

## Reliability
- [ ] err-boundary: 异常不裸抛、有统一 error handler
- [ ] err-observability: 至少 stderr 结构化 / Sentry-style hook
- [ ] tests-smoke: 至少 1 个 e2e smoke 覆盖核心 flow
- [ ] tests-unit: 关键逻辑有单测

## Productization
- [ ] deploy-config: 有部署配置（Dockerfile / Vercel / Fly.toml / ...）
- [ ] deploy-env-doc: 环境变量列表 + 示例
- [ ] docs-readme: README 含安装/启动/部署 三段
- [ ] docs-changelog: CHANGELOG 起点
- [ ] license: LICENSE 文件 + package.json license 字段

## Polish
- [ ] ui-loading: 异步操作有 loading 态
- [ ] ui-error: 失败有用户可见错误
- [ ] perf-baseline: 关键页面 < 3s LCP（或同等指标）
```

- d2p 启动 differ 时把 preset markdown 原文 + 当前 repo 状态丢给 differ agent，由其判断每一条 status（done / partial / missing）；missing 的就转成 gap
- 用户可在 `<demo>/.d2p/preset-overrides.yaml` 里加 / 删 / 标 N/A 某些条目
- **MVP-0 内置 preset**：`saas-web.md`、`api-service.md`、`cli-tool.md`、`library.md`、`static-site.md`、`unknown.md`（空 baseline）

### 4.8 Gap Differ (`daemon/src/differ/`)

- Worker 模型：`claude --model sonnet -p`
- 输入 prompt 含：
  - `vision.md` 全文
  - 选定 preset markdown
  - repo 浅扫摘要（同 detector，但更深）
  - 已 DONE 的 gap 历史（避免重复）
- 输出 JSON：

```json
{
  "gaps": [
    {
      "slug": "auth-signup",
      "title": "Add user signup with email/password",
      "body": "Currently no auth surface; vision requires user accounts...",
      "category": "auth",
      "severity": "P1",
      "source": "both",
      "suggested_approach": "Use next-auth credentials provider with SQLite session store"
    }
  ],
  "preset_status": [
    {"item": "auth-signup", "status": "missing"},
    {"item": "tests-smoke", "status": "partial", "note": "1 test exists but doesn't cover login"}
  ]
}
```

### 4.9 Implementer (`daemon/src/implementer/`)

- Worker 模型：`claude --model sonnet -p`（特别复杂时升 opus，由 reviewer 触发）
- 工作目录：`.d2p-worktrees/<demo>-fix-<slug>/`（已切到 `fix/<slug>` 分支）
- Prompt 含：
  - Gap title + body + suggested_approach
  - Worktree path + 必须在此目录内工作的硬约束
  - 期望产出：一组 file edits + 一个 commit（conventional commits 格式）
  - Hints（若 retry 携带，上一轮 reviewer 的 RETRY hints）
  - 不许触碰：`.d2p/` / `.d2p-worktrees/` / 其他 worktree
- 期望输出 JSON：

```json
{
  "files_changed": ["src/auth/signup.ts", "src/db/users.sql"],
  "commands_run": ["npm install bcrypt", "npm test -- auth"],
  "test_output_excerpt": "...",
  "commit_sha": "abc1234",
  "residual_risks": ["email verification not implemented; gap-only covers signup"],
  "confidence": 0.82
}
```

### 4.10 Reviewer Pipeline (详 §5)

### 4.11 Branch / Worktree Manager (`daemon/src/git/`)

- **创建 fix 分支**：
  ```
  cd <demo> && git fetch . main:main
  git worktree add ../.d2p-worktrees/<demo>-fix-<slug> -b fix/<slug>
  ```
- **Merge 回 main**：
  ```
  cd <demo> && git fetch . fix/<slug>:fix/<slug>
  git merge --no-ff fix/<slug> -m "merge fix/<slug>: <gap title>"
  git branch -d fix/<slug>
  git worktree remove ../.d2p-worktrees/<demo>-fix-<slug>
  ```
- **冲突**：MVP-0 串行实施意味着 fix 分支永远从 latest main 切，理论上无冲突。如出现（rare），mark gap NEED_HUMAN
- **Rollback**：`git reset --hard HEAD^`（仅在 fix 分支自己内部用；main 永远只 fast-forward / no-ff merge，**绝不**对 main `reset --hard`）
- **Worktree 红线**（继承自 Cairn `CLAUDE.md`）：在 worktree 里禁 force push / `--no-verify` / 手删目录 / 跨分支 checkout

### 4.12 Done-Check Evaluator (`daemon/src/done-check/`)

- 每次 fix merge 后跑一次
- **Preset gate**：扫 preset 的 status JSON，全为 `done` 才进 vision 评
- **Vision gate**：`claude --model sonnet -p` 看 `vision.md` + repo 摘要 + 已完成 gap 列表，输出：

```json
{
  "vision_satisfied": true | false,
  "rationale": "...",
  "remaining_themes": ["billing not yet implemented per vision §3"]
}
```

- 双绿才宣 done。任一未达 → 继续 loop（differ 重新生成 gap 队列）

### 4.13 Live Run Log (`daemon/src/log/`)

- 每个 agent spawn 时立刻插一条 `log_events` (kind=AGENT_START, payload={role, model, gap_id})
- Agent 收尾时插 `AGENT_END` + thought summary
- 里程碑事件：`DIFF_PRODUCED` / `GAP_PICKED` / `WORKTREE_CREATED` / `FIX_COMMITTED` / `STATIC_GATE_PASSED|FAILED` / `REVIEW_VERDICT` / `MERGED` / `LOOP_PAUSED` / `DONE` / `ESCALATED`
- SSE 流推送给 UI；UI 默认折叠详情，用户点开看 raw stdout/stderr
- 持久 SQLite，可回看历史

---

## §5. Reviewer Pipeline（深）

> 用户明示 reviewer 是 d2p 最重要的部分。本节超详写。

### 5.1 4 层关卡

```
Implementer 完成 commit
        │
        ▼
  ┌─────────────┐
  │ Static Gate │  非 AI。跑 npm test / tsc / 项目自定义命令
  └──┬───────┬──┘
     │PASS   │FAIL → 进失败处理（§5.5）
     ▼
  ┌──────────────────┐
  │ Alignment Probe  │  claude --model haiku -p
  │ JSON: {alignment: 0-1, concerns: [...]}
  └──┬──────────┬────┘
     │≥0.7      │<0.7 → RETRY_WITH_HINTS
     ▼
  ┌─────────────────────┐
  │ Behavioral Reviewer │  claude --model sonnet -p, fresh ctx
  │ Verdict JSON
  └──┬──────────────┬───┘
     │APPROVE       │OTHER → 决策树（§5.5）
     ▼
  ┌────────────────────────┐
  │ Adversarial Reviewer   │  仅高敏 gap（auth / 输入 / SQL / IPC / 文件 / 网络）
  │ claude --model sonnet -p, 攻击视角
  └──┬────────────────┬────┘
     │SAFE            │BREAK → ROLLBACK，回 RETRY_WITH_HINTS
     ▼
  Merge to main → re-diff
```

### 5.2 Verdict schema

Behavioral reviewer 必须返这个 schema（其余字段不接）：

```json
{
  "verdict": "APPROVE | RETRY_WITH_HINTS | ROLLBACK | ESCALATE",
  "confidence": 0.0,
  "reason_code": "OK | DIVERGES_FROM_GAP | BUGGY | INCOMPLETE | OVER_SCOPED | ARCHITECTURAL | SCOPE_TOO_LARGE | TOO_HARD",
  "rationale": "one paragraph",
  "hints": ["specific guidance line 1", "..."],
  "split_into": null | [{"slug": "...", "title": "...", "body": "..."}],
  "difficulty": 1 | 2 | 3 | 4 | 5
}
```

`difficulty` 用于动态 K（§5.4）。`split_into` 仅 reason_code=SCOPE_TOO_LARGE 时填。

### 5.3 Adversarial Reviewer

- **触发条件**：gap.category ∈ {auth, input-validation, sql, ipc, file-ops, network, crypto, deploy} 或 reviewer.confidence < 0.85
- **Prompt 角度**：「你是渗透/QA 视角，目标是构造一个输入或场景让此 fix 失败。先列 3 个攻击向量，再对每个写一段代码 / 流程模拟，告诉我能否破坏。」
- **输出**：

```json
{
  "attempts": [{"vector": "...", "sim": "...", "broke": true|false, "evidence": "..."}],
  "any_break": true|false
}
```

- `any_break === true` → 视作 ROLLBACK，hints = 所有 broke=true 的 vector

### 5.4 动态 K（retry 上限）

- K = `clamp(reviewer.difficulty, 1, 3)`
- difficulty=1 → K=1（普通 typo / 加 license 文件）
- difficulty=3 → K=2（写 module / 中等改造）
- difficulty=5 → K=3（大重构 / 多文件协同）
- 达到 K 仍 RETRY → 升级 reason_code:
  - 若上一轮 reason 主因 BUGGY/DIVERGES → ESCALATE TOO_HARD → mark gap NEED_HUMAN
  - 若主因 SCOPE_TOO_LARGE → reviewer 强制 split → 子 gap 重入队，原 gap 标 SPLIT_DONE
  - 若主因 ARCHITECTURAL → pause 整个 loop，UI 显「需要架构决策」+ reviewer rationale，等用户介入

### 5.5 Escalate 路由

| reason_code | 路由 |
|---|---|
| `OK` | merge |
| `DIVERGES_FROM_GAP` / `BUGGY` / `INCOMPLETE` | RETRY_WITH_HINTS（最多 K 次） |
| `OVER_SCOPED` | 让 implementer 重写、缩窄改动；hints 含「移除以下变更」清单 |
| `SCOPE_TOO_LARGE` | reviewer split → 子 gap 入队 |
| `ARCHITECTURAL` | pause loop |
| `TOO_HARD` | mark gap NEED_HUMAN，跳过，loop 继续别的 gap |

### 5.6 Static Gate 命令推断

- d2p 首次进 demo 时跑 detector 还输出 `inferred_check_commands`：
  ```json
  {"build": "npm run build", "test": "npm test", "typecheck": "tsc --noEmit"}
  ```
- 用户可在 `<demo>/.d2p/check-commands.yaml` 覆盖
- 命令缺失（没 `package.json` / 没 test）→ 跳过该项，Static Gate 视为 PASS（不阻塞 alignment）

### 5.7 失败 commit 的留痕

- ROLLBACK 时 fix 分支 `git reset --hard HEAD^` + worktree 保留到本 gap 完全结束
- 每次 attempt 记 `fixes` 表（attempt=1/2/3），SQL 可回看「这个 gap 试了几次、每次为啥废」
- 最后一次成功的 attempt 才 merge 到 main，前面 attempt 的 commit 死在 fix 分支并随 worktree 删除一起消失

### 5.8 Reviewer 模型路由

| 角色 | MVP-0 模型 | 升级条件 |
|---|---|---|
| Alignment probe | haiku | 永远 haiku（快） |
| Behavioral | sonnet | reviewer.confidence < 0.7 时改下次同 gap 用 opus |
| Adversarial | sonnet | gap.category=crypto/auth 时强制 opus |
| Implementer | sonnet | 第二次 retry 且 difficulty ≥4 时升 opus |
| Differ | sonnet | 永远 sonnet |
| Done-check vision | sonnet | preset 全绿后第一次 vision-check 用 opus 把关 |

### 5.9 Cross-engine match（MVP-1+）

MVP-0 不上。MVP-1+：对 verdict=APPROVE 的高敏 fix，再起一个独立 sonnet reviewer 做 second pass，verdict 不一致就强制 ROLLBACK。对应 Cairn FEATURE-VALIDATION 1+2+3 的精神。

---

## §6. Preset Format（详）

### 6.1 文件位置 & 命名

- `presets/<type-slug>.md`
- 内置：`saas-web.md`、`api-service.md`、`cli-tool.md`、`library.md`、`static-site.md`、`unknown.md`
- 用户 override：`<demo>/.d2p/preset-overrides.yaml`（按 item slug 操作）

### 6.2 Frontmatter

```yaml
type: saas-web                 # 必填，匹配 detector type 集
name: SaaS Web Application     # 必填，UI 显示
version: 1                     # 必填，preset schema 版本
inherits: []                   # 可选，未来支持继承（MVP-0 不用）
high_sensitivity_categories:   # 可选，触发 adversarial 的 category 集
  - auth
  - input-validation
```

### 6.3 Body 结构

- 一级标题 `# <Preset Name>` 一次
- 二级标题 `## <Category>` 分组
- 每个 item 一行：`- [ ] <slug>: <human description>`
- slug 必须唯一在 preset 内，kebab-case，匹配 `^[a-z][a-z0-9-]*$`

### 6.4 Override YAML

```yaml
# <demo>/.d2p/preset-overrides.yaml
add:
  - slug: oauth-google
    category: auth
    description: Google OAuth as alternate login
    severity: P2
remove:
  - tests-unit                 # 这个 demo 不写单测
skip:
  - deploy-config              # 暂不部署
```

### 6.5 与 Differ 的契约

Differ 收到 preset markdown 原文，自行解析（不在 daemon 解析以避格式僵化）。但 daemon 解析 frontmatter 提取 `high_sensitivity_categories`。

---

## §7. Loop Mechanics

### 7.1 状态机

Session：`SETUP → LOOPING → (PAUSED ↔ LOOPING)* → DONE | ENDED`
Gap：`PENDING → IN_PROGRESS → (RETRYING)* → DONE | SKIPPED | NEED_HUMAN | SPLIT_DONE`
Fix attempt：`STARTED → STATIC_GATE_(PASS|FAIL) → ALIGNED_(PASS|FAIL) → REVIEWED_(APPROVE|RETRY|ROLLBACK|ESCALATE) → ADVERSARIAL_(SAFE|BREAK) → MERGED | DROPPED`

### 7.2 并发

- MVP-0 默认 1（串行）
- 同 demo 内 fix 分支永远从 latest main 切，零冲突可能
- MVP-1+：UI slider 1-N；并行时 daemon 强制写集不重叠（implementer 在 prompt 中声明 `expected_files_changed`，daemon 校验 fix branch diff 与之相符；重叠 ROLLBACK）

### 7.3 Pause 语义

- UI 点 Pause → daemon 设 session.status=PAUSED
- 当前 attempt 不中断（避免半截 worktree），跑完即停下一个
- 显示「Pausing... (current attempt finishing)」徽标
- 完全停后显「Paused. Resume?」按钮

### 7.4 Re-diff 节奏

- 每次 fix MERGE 后立刻跑 done-check
- 双绿 → done
- 未双绿 → 跑 differ 重新生成 gap 队列（保留 NEED_HUMAN / SKIPPED 标记，新 gap 入队尾）
- gap 队列 empty 但未双绿 → vision evaluator 显式给 "remaining_themes"，differ 用这个再推一波

### 7.5 Cost tracking

- `claude` CLI 输出含 usage 信息时 daemon 抓 token 计数写 `cost_records`
- UI 右栏实时显累计 tokens / 估价（按公开价格本地估算）
- MVP-0 不设 cap

---

## §8. Phasing

> 没有版本路线（v0.2 / v0.3）—— 借鉴 Cairn PRODUCT.md D10，只有 "MVP-0 / MVP-1 / Later"。
> MVP 阶段评估只问"在 MVP 里 / 不在"。

### MVP-0 ── Walking Skeleton + 真闭环

**目标**：端到端跑通一次。Demo + vision → loop → 至少 1 个 gap 自动 fix + merge → 双绿（或人工 stop）。
**范围**（详 `docs/plans/2026-05-12-walking-skeleton.md` 重写版）：

- Daemon 一体进程（Hono + Vite 共生）
- 单 demo session、串行 loop
- Vision elicitor（多轮，5 轮上限）
- Project detector（haiku，6 内置 preset）
- Differ + Implementer + 4 层 reviewer（含 adversarial 但跳 cross-engine）
- Branch + worktree 自动管理
- Live Run Log（事件 + thought summary）
- UI：Setup → Workspace → Done 三页
- CLI：start / stop / status / open / doctor
- SQLite 持久化、resume 支持

### MVP-1

- Daemon 拆出为系统服务（systemd / launchd / Windows Service + `d2p install-service`）
- 并发 N（写集隔离）
- Cross-engine reviewer second-pass（高敏 gap）
- 用户 preset 自定义 UI（不只手编 YAML）
- 多 demo session 切换（同时仅一活跃 loop）
- Cost cap 可配
- Token usage 抓取打磨

### Later（无时间绑定）

- 远程 daemon（一台机器跑 daemon，多台浏览器连）
- 多 demo 并行 loop
- Plugin 化 preset（npm 包形态，社区造 preset）
- Deploy target 直推（Fly / Vercel / app store）
- Live re-diff 触发（watcher 在用户改 vision.md 时自动）
- 跨机同步 / 团队多人协作
- 非代码输入支持（PRD / mockup 图 / API spec）
- 接其他 engine（Codex / Cursor / Aider）
- Mobile UI（响应式）
- Reviewer ESCALATE → pause 时的人机 hand-off UX

---

## §9. Out of Scope（明确 ¬，本 doc 内不展开）

- ❌ 直调 Anthropic API
- ❌ 用户 approval gate（不审 diff）
- ❌ Cost cap
- ❌ Mobile / 跨机同步 / 云部署
- ❌ Chat IM / 任务看板形态
- ❌ 多 agent 并行（MVP-0）
- ❌ Plugin preset 机制（MVP-0/1）
- ❌ 非代码输入（PRD / mockup）
- ❌ 接 Codex / Cursor / Aider
- ❌ 自动 push / 开 GitHub PR（保留 git 本地，push 由用户在外部决定）
- ❌ 接 Cairn kernel（d2p 完全独立；二者后期可能集成但本 MVP 不依赖）

---

## §10. Open Decisions / TBD

实施期间需要拍板但 doc 暂留默认：

1. **`d2p` CLI 包名与全局分发** — npm publish？file-link？git clone install？默认：MVP-0 git clone + npm link
2. **License** — d2p 自身 license？默认：MVP 不放 LICENSE，等用户决定
3. **Telemetry** — 是否上报 cost / 错误？默认：完全不上报（MVP 单机本地）
4. **Vision elicit 提问引擎** — 用 haiku 还是 sonnet 生成下一轮问题？默认：haiku（快、便宜）
5. **Preset 类型扩展机制** — 用户怎么加自定义 type？默认：MVP-0 只能 fallback "unknown"，MVP-1 UI 允许 import markdown
6. **Cost 估算价格本地表** — 维护在哪？默认：`daemon/src/cost/pricing.ts` 硬编码，年度手动更新
7. **`claude` CLI 不可用时的降级** — 默认：`d2p doctor` 检测失败，UI 显警告 + 链接到 cc 安装指引
8. **GitHub PR / push** — 后期是否接？默认：Later
9. **多 monorepo demo 怎么算一个 demo** — 默认：用户传谁就是谁，d2p 不解析 monorepo

---

## Appendix A — File Layout

```
D:\lll\d2p\
├── CLAUDE.md                            # 工作流 + 项目坐标
├── README.md                            # （TBD）
├── package.json                         # workspaces: daemon, ui, cli
├── tsconfig.base.json
├── .gitignore
│
├── docs/
│   ├── DEV-DOC.md                       # 本文件
│   ├── plans/
│   │   └── 2026-05-12-walking-skeleton.md
│   └── workflow/                        # （后续按需 fork Cairn 的 8 站台）
│
├── presets/
│   ├── saas-web.md
│   ├── api-service.md
│   ├── cli-tool.md
│   ├── library.md
│   ├── static-site.md
│   └── unknown.md
│
├── daemon/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── server.ts                    # Hono entry, port 5174
│       ├── routes/
│       │   ├── session.ts
│       │   ├── vision.ts
│       │   ├── loop.ts
│       │   ├── gaps.ts
│       │   ├── preset.ts
│       │   └── log.ts                   # SSE
│       ├── orchestrator/
│       │   └── loop.ts                  # 主循环状态机
│       ├── detector/index.ts
│       ├── vision/index.ts
│       ├── differ/index.ts
│       ├── implementer/index.ts
│       ├── reviewer/
│       │   ├── alignment.ts
│       │   ├── behavioral.ts
│       │   ├── adversarial.ts
│       │   └── done-check.ts
│       ├── git/
│       │   ├── worktree.ts
│       │   └── merge.ts
│       ├── subproc/spawn.ts             # claude / git 调用单出口
│       ├── storage/
│       │   ├── db.ts
│       │   └── migrations/
│       │       ├── 001-init.ts
│       │       ├── 002-presets.ts
│       │       └── 003-cost.ts
│       ├── log/events.ts
│       ├── cost/pricing.ts
│       └── types.ts
│
├── ui/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api.ts                       # daemon REST + SSE client
│       ├── store.ts                     # Zustand
│       └── pages/
│           ├── Landing.tsx
│           ├── Setup.tsx
│           ├── Workspace.tsx
│           └── Done.tsx
│
├── cli/
│   ├── package.json
│   ├── tsconfig.json
│   ├── bin/d2p
│   └── src/index.ts
│
├── scripts/
│   └── smoke-walking-skeleton.mjs
│
├── fixtures/
│   └── demo-saas/                       # tiny next.js demo for dogfood
│
└── tests/
    ├── daemon/
    ├── ui/
    └── cli/
```

## Appendix B — Glossary

- **demo**：用户给 d2p 的本地代码仓库
- **vision**：用户告诉 d2p 想做成什么样的 product
- **preset**：按项目类型预制的 baseline 必备能力清单
- **gap**：preset 或 vision 推出的「缺失项」，每个 gap 对应一个 fix attempt
- **fix**：一次实现尝试，落在 `fix/<slug>` 分支 + 一个 worktree
- **attempt**：同一 gap 内的第 N 次尝试（retry 时计数）
- **session**：用户对一个 demo 的一段连续工作；可暂停/恢复
- **worker**：spawn 出来的 `claude -p` 子进程，单次任务
- **reviewer pipeline**：Static Gate → Alignment Probe → Behavioral Reviewer → (Adversarial)
- **double-green**：preset all done + vision verdict YES，loop 退出条件
- **cc**：Claude Code CLI
