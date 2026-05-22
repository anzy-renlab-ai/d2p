# ZeroU — Claude 项目说明（原 d2p）

> 给未来 Claude 会话用。仓库特定的坑与本地约定写这里。

## d2p 是什么

**d2p = demo to product** (本地 web app + 独立 daemon)：用户给本地 demo（任意 folder，d2p 自动 git init）+ 多轮对话 elicit 的 vision → d2p 自动识别 gap → 派 Claude Code CLI subprocess 写代码 → 4 层 reviewer pipeline 验 → 自动 commit/merge → 循环到 preset + vision 双绿。

**关键设计选择**（12 轮 grill 锁定，详 `docs/DEV-DOC.md` §0）：
- **AI 引擎**：不持 API key，全部 `claude --model X -p` CLI 子进程
- **形态**：本地 web app（localhost）+ 独立 daemon；UI 关页面不停作业
- **Approval**：无——用户不审 diff，trust agent + reviewer
- **Done**：preset 全绿 + vision verdict YES（双绿）
- **Branch**：仓外 worktree，每 fix 一分支，d2p 自动 merge main
- **Reviewer**：Static gate → Alignment probe → Behavioral → (Adversarial 高敏 gap only)

它**不是** chat IM / 任务看板 / Cairn 替代品 / IDE / Cursor clone / 通用 multi-agent framework / 直调 Anthropic API。

## 完整开发文档

**核心文档**：`docs/DEV-DOC.md`（10 节 + 2 附录，含全部组件 spec、reviewer pipeline 深度设计、SQLite schema、文件布局）

## 当前阶段

**MVP-0 Walking Skeleton**——端到端真闭环。详 DEV-DOC §8 + `docs/plans/2026-05-12-walking-skeleton.md`。
MVP-1+ 延后清单：系统服务化 daemon、并发 N、cross-engine reviewer、自定义 preset UI、cost cap、多 demo 切换。

## Agent Work Rules

新会话上来先读这一节，再做任何动作。

### Gates

- **多阶段 / >30min 任务先写 ≤5 行验收 checklist**：目标 / 不变量 / 验证命令 / 不做什么 / 完成标准。结束逐项自评。
- **改 IPC / 跨进程 / DB schema / 文件系统 / 外部 API 行为时，单测绿不算完成**。必须跑真实 dogfood / smoke，报告里给具体命令与结果。
- **写 README / 设计文档 / PR 描述前自检定位漂移**。定位锁定后（见本文顶部）不要悄悄改 framing。
- **"完成" = 原始产品目标全部达成，不是 MVP-N / Phase-N / Walking Skeleton 边界。** Phase 划分只是开发顺序，不是停手时机。把"原始目标里要的功能"分到"下个会话 / MVP-1+ / Later"是 followup_punt 的变种 — 同样禁。停手只在三种情况：① 用户明确说停 ② 需要用户决策 / 外部凭据（real cc 登录、deploy 凭据、远程 URL 等真实物理依赖） ③ 已达到原始 spec 全部 done。`acceptance checklist` 第 4 行"不做"只能列上述三类，不能列"留下个会话做"。
- 在 long-haul 任务里（"完整做完"、"做完再停"、"长程任务" 等措辞），每完成一个内部里程碑后**主动继续**到下一项，不暂停问"要不要继续"——除非命中上面三停手条件之一。
- **新用户面（UI 页 / CLI 命令 / HTTP endpoint / 新 agent role）必须同 commit 落地 auto-runnable 测试**。UI = 至少 jsdom 组件测试一份 + Playwright e2e 至少一份；CLI = vitest 单测 + smoke 调用；HTTP = smoke 里 curl 断言 status+body。"manual smoke"、"后面补"、"先实现后测试"全部不算交付。判定：`npm test` 能不能复跑这个验证？不能 = 没做完。

### Decision Rules

- **可逆 / 局部 / 5 分钟内可撤销**：agent 自决，但最终报告里说明（选了什么 / 为什么）。
- **不可逆 / 影响 git 历史 / 外部系统 / 产品定位 / 安全边界 / license / release / push**：先问用户。包括 force push、amend 已 push commit、改 origin、删 branch、改 LICENSE、打 tag、npm publish、改产品定位文档、引入新 npm dep。

### Delegation Rules

- 开工前判断读写集。读任务可并行；写任务**文件集合不重叠**才能并行。
- **关键路径阻塞任务不交给 subagent 等结果**。Subagent 用于：独立调研、并行读、schema check、并行 smoke、文档审计。
- Subagent 报告必须含：**改了哪些文件 + 跑了哪些命令 + 测试结果 + 残余风险**。主 agent 接到要验证（trust but verify），不能直接转述。

### Reporting Rules

- 交付时**先列文件路径和 commit hash**，再讲内容。
- 报告必须明确：
  - 测试是否跑过 + 命令 + 结果
  - dogfood 是否跑过 + 哪个脚本 + 结果
  - **是否 push**（默认未 push）
  - **是否触碰 unrelated dirty files**（默认不碰）
- 不模糊用词。"已完成"必须有验证证据；"应该可以"不算交付。

---

## Workflow Discipline — 8 站台 + 3 安全网

任何非 trivial 改动（多文件 / 新 dep / migration / IPC / 新 API）必须走这套。
Trivial = 单行 typo / <50 行 docs / 单 config 改 — 直接 commit。

### 8 站台

#### 1. GRILL — 强制澄清

执行前必须能无歧义说出：
1. **输出长什么样** — 文件路径、schema、可观察行为
2. **谁怎么用** — runner、环境、调用方式
3. **"done" 怎么验** — 可执行命令 + 期望输出
4. **什么明确不做** — 防止中途漂移

≤3 轮，每轮 ≤3 题，每题给 A/B/C 选项（不要开放式）。
停止条件：能直接写 DUCKPLAN 不用猜。

#### 2. DUCKPLAN — 四段式计划

文件位置：`docs/plans/YYYY-MM-DD-<slug>.md`

必须四段齐：
- **Plan**：具体改什么，不是模糊"改进 X"
- **Expected Outputs**：工作完成后存在的 artifacts（文件、binary、commit、schema 行）
- **How To Verify**：reviewer 能跑的 exact command + deterministic check
- **Probes**：快速 JSON probe（`claude --model haiku -p`），给 1+2+3 hard-match 用

任何一段缺 → plan reject。
多个无关改动 → 拆成多个 plan。

#### 2.5. SPEC-SPLIT — dev doc 与 test doc 独立写

**何时用**：非 trivial 新模块（>3 文件 / 新公开 API / 复杂状态机 / 跨进程边界）。Trivial 改动跳过。

**4 步流程**：

1. **写 dev doc**：`docs/details/<NN>-<slug>-spec.md`，含全实现细节、库选择、文件 layout、数据结构。
2. **提取 public surface**：`docs/details/<NN>-<slug>-public-surface.md`。**只含**：函数签名 / 接口 / 行为契约（编号 B-X-Y） / 失败模式 / 错误码 / 配置 schema。**不含**：实现细节 / 库选择 / 内部数据结构 / 文件路径。
3. **派独立 subagent 写 test doc**：Prompt **显式禁止**读 spec / 源码——**只读 public surface**。subagent 写到 `docs/details/<NN>-<slug>-tests.md`。每个 Behavior 至少 1 个 happy path + 1 个 negative test。Coverage Map 反查表必给。
4. **比对找 gap**：写 `docs/details/<NN>-<slug>-comparison-report.md`。三类 gap：
   - (A) dev doc 承诺但 test 没覆盖 → test 补
   - (B) test 假设但 surface 没暴露 → **surface 缺 contract**（最有价值的 gap，是真实 contract gap）
   - (C) 两边说话不一致 → unify
5. 修 gap (surface / dev doc / 实现) 然后才进 TEAMWORK 并行实现。

**Why**：Knight-Leveson 1986 N-version independent failure 在文档层的应用。**dev 写者 + test 写者读不同 input** 写出来的 doc 能挖出单一作者写不出的真 contract gap——dev 作者知道实现就不会觉得 surface 缺什么。已在 `docs/details/11-mvp-0.5-comparison-report.md` 实证（subagent 黑盒视角挖出 2 个真 surface gap：JSON schema 没暴露 / CLI trigger 没暴露）。

**Skip when**：单文件 typo / docs-only / config 改 / <50 LOC 单函数工具 / 已有 spec 无新公开 API 的修补。

#### 3. TEAMWORK — 并行派单

N tasks 并行的条件：写集不重叠 + 每个 >15min + 互不依赖。
模式：**N sonnet workers + 2N haiku probes + 1 opus reporter**。

- 每个 worker 一个 git worktree：`.worktrees/<task-slug>`
- Lead agent 也进 worktree（`.worktrees/__lead__`），**不在主 checkout 干活**
- `.worktrees/` 必须 gitignored
- Dispatch 给 worker 的 prompt 必含：Task / Plan ref / Worktree / Acceptance checklist / Verify command / Out of scope / Reporting requirement

模型路由：opus = reporter / 架构 / plan review；sonnet = worker 实现；haiku = JSON probe / 机械验证。

#### 4. FEATURE-VALIDATION 1+2+3 — 跨引擎硬匹配

| Gate | 工具 | 输出 |
|---|---|---|
| 1 — Fast probe | `claude --model haiku -p` | 描述 artifact 的 canonical JSON |
| 2 — Second engine | Agent subagent（`general-purpose`，fresh context） | 同样 schema 的 JSON |
| 3 — Real run | 直接 `Bash` 执行，verbatim 捕获 stdout/stderr | artifact 真实输出 |

Gate 1 ≠ Gate 2（`jq -S` 后 byte-identical 失败）→ 一方在幻觉或 prompt 歧义，**不要 ship**。
Gate 1+2 同意但 Gate 3 不同意 → AI 联合错，信 Gate 3 改 artifact。
**绝不**用"测试 flaky 重试"解决；read the diff。

豁免：trivial docs / 纯 format / revert。

#### 5. AUTOSHIP — commit + push + 开 PR

不需要用户点头（auto-authorized）。
需要用户点头：merge / tag / npm publish / force push / 改 LICENSE / 改产品定位文档 / 加新 npm dep。

- 分支名：`<type>/<slug>`，从最新 main 切
- Conventional commits（feat / fix / chore / docs / test），body 解释 why 不解释 how
- **不加 `Co-Authored-By: Claude` trailer**
- 暂存前 `git status` 过一遍，可疑名字（单字符 / 前缀 `{` `&` / 怪后缀）不要 stage
- 永不 stage：`.env*` / token 文件 / `node_modules/` / `dist/` / `.worktrees/`

doc-only / config-only 改（零 code-file delta）可直接 push main。

#### 6. POSTPR — auto-review loop

push 后立刻 dispatch reviewer Agent（`general-purpose`，fresh context）。
输入：PR diff + plan ref + acceptance checklist。
输出每条 finding：Severity (P1/P2/P3) / File:line / Issue / Why / Suggested fix。
末尾必须 `VERDICT: READY_TO_MERGE` 或 `VERDICT: NEEDS_FIX (n=K)`。

**Hard rule**：P1 / P2 在**当前 PR**修，**绝不**开 follow-up issue 推。P3 可推迟（写明理由）。

#### 7. STOP CONDITIONS — 三条全绿才能合

1. **CI green** — 所有配置的 check_runs `conclusion = success`
2. **No conflict** with target branch
3. **Reviewer silent or 👍** — 最新 reviewer 输出 `VERDICT: READY_TO_MERGE`

任一未达 → 不合 → 不点 merge 按钮。

#### 8. MERGE — 需用户点头

PR-PLAN 闭环条件（reviewer 返 NEEDS_FIX 时的 fix plan，文件 `docs/plans/YYYY-MM-DD-pr-<n>-fix-plan.md`，三段：Tasks / Expected Outputs / Judge Harness）：
1. 所有 P1/P2 task 实现并 commit
2. 重新 dispatch reviewer 返 `VERDICT: READY_TO_MERGE`
3. CI green，无冲突

满足后向用户报告等点头。

### 3 安全网

#### 安全网 A — SELF-REPORT-STOP 13 字段自检

含代码改 / commit / push / 测试声明的消息发出前，自查 13 字段。任一为真则修后再发：

1. `premature_stopping` — 声明 done 但 checklist 有未验证项
2. `permission_seeking` — 问已 pre-authorized 的问题
3. `silent_fallback` — try/catch 吞错返默认值
4. `unverified_claim` — 说"X 过了"但本轮没跑 verify
5. `paraphrased_output` — 复述工具输出而非 verbatim
6. `scope_creep` — 改超出 plan 授权
7. `destructive_shortcut` — `git reset --hard` / `--no-verify` / `--force` / `.skip` / `@ts-ignore` 让 check 过
8. `followup_punt` — 把 P1/P2 推 follow-up issue
9. `mock_in_integration` — 集成测试里 mock 被测对象
10. `single_engine_attest` — 该跨引擎验证的只用了一个 engine
11. `untracked_state_change` — 改了 message 没提及的文件
12. `tool_use_without_intent_statement` — 连续工具调用前没用 user-visible text 说意图
13. **`phased_premature_stop`** — 把"原始产品目标里要的功能"以 MVP-N / Phase-N / Walking Skeleton / "下个会话" 为由推迟。这等价于 followup_punt 的变种。仅以下三种情况可停：① 用户明确说停 ② 需要用户决策 / 外部凭据 / 物理依赖（如真 cc 登录） ③ 原始 spec 全部 done。
14. **`surface_without_self_test`** — 引入了用户面（UI 页 / CLI / HTTP endpoint / 新 agent role）但同 PR 没落地 auto-runnable 测试。「manual smoke」/「后面补」不算。判定：让另一个人 clone 仓库 `npm test` 能不能复验这条路？不能 = 这条字段为真。

#### 安全网 B — Worktree 红线

在 `.worktrees/<task>` 里**禁止**：

- ❌ `git reset --hard` 来"恢复坏 commit" — 用新 commit 反向覆盖
- ❌ `git push --force` 从 worktree — PR 分支 append-only
- ❌ `--no-verify` 跳过 hook — 调 hook 为啥怒
- ❌ 手删 worktree 目录 — 永远 `git worktree remove <path>`
- ❌ `git checkout <branch>` 在 worktree 内 — 每个 worktree 钉一个 branch

不可恢复就停下问 lead，subagent 不能默默修 worktree 损伤。

#### 安全网 C — 禁忌动作清单（push / fix 期间）

- ❌ `git push --force` / `--force-with-lease` 到 main 或共享分支
- ❌ `git reset --hard` 让 diff 变小
- ❌ `--no-verify` 跳 pre-commit hook
- ❌ `--no-gpg-sign` 跳签名
- ❌ Amend 已 push 的 commit
- ❌ `git checkout .` / `git restore .` 覆盖未 commit 的对方工作
- ❌ 加 `@ts-ignore` / `eslint-disable` / `.skip` 让 check 通过而不查根因
- ❌ 把 P1/P2 推 follow-up issue 然后 merge

伸手做这些 → 停 → 调根因。Push 没准备好。

---

## 风格约定

- 与用户对话用**中文**，代码 / 命令 / 文件路径用**英文**
- commit message 用 conventional commits，body 用英文短句
- **不加 `Co-Authored-By: Claude` trailer**
- 用户口味：直说，不空话；产出物先给路径再讲内容；3 选 1 选项题给清单不给散文
- subagent 驱动开发：每个 task 一只新 sonnet，避免上下文积累；mechanical 用 haiku；战略分析用 sonnet / opus

---

## 项目坐标

- **仓库 origin**：TBD（MVP-0 阶段先 local-only，第一次 push 前与用户确认 remote）
- **本地路径**：`D:\lll\d2p`
- **主分支**：`main`
- **技术栈**（MVP-0 提议，待用户 confirm）：
  - UI shell：Electron 32 + plain HTML / CSS / JS（无 React / Vue / Svelte / Tailwind / Vite）
  - Core：TypeScript on Node 24
  - State：`better-sqlite3 ^12.9.0`
  - Claude：`@anthropic-ai/sdk`
  - Git：shelled-out `git` CLI
  - Tests：`vitest`
- **测试命令**：`npm test`（待 package.json 落地后生效）
- **dogfood / smoke**：`node scripts/smoke-walking-skeleton.mjs`（待脚本落地后生效）
- **plans**：`docs/plans/YYYY-MM-DD-<slug>.md`

## 环境

- **OS**：Windows 11
- **Shell**：PowerShell（默认）+ bash via Bash 工具
- **路径风格**：bash 用 `/`，Windows 工具吃 `\`，Read/Write 用绝对 Windows 路径
