# Phase 10 — `zerou enhance` 真改代码的优化 action

> ZeroU 第三档核心价值：**audit 找问题 → enhance 真改代码 → 验证 → 报告**。
> 把 demo 从"能跑"提升到"上市生产级"：装 logger + 注入 log + 修可机械修的 bug + 加 health + 装 sentry + 补 .env.example。

---

## Goal

让用户在自己 demo 上跑：

```bash
$ zerou audit ./my-app         # 列出 N 个可优化点
$ zerou enhance ./my-app       # 真改，写到 .worktrees/zerou-enhance-{ts}/
$ cd .worktrees/zerou-enhance-{ts}/ && git diff main..HEAD
$ # 满意 → git merge zerou-enhance-{ts}
$ # 不满意 → 直接删 worktree
```

输出"真 action"——不只 finding 列表，而是**摆在用户面前的 git diff**。

## Non-Goals (v1)

- ❌ 不做 UI / dashboard / 实时可视化
- ❌ 不做"全自动修一切 bug"——只修可机械修的（escapeXml / encodeURIComponent / silent catch / 缺 await 等模式化问题）
- ❌ 不做 cross-engine 修补 verification（同 critic 跑 tsc + test 就行）
- ❌ 不做"反向 commit 到 main 分支"——永远在 worktree，永远等用户 merge
- ❌ 不替用户决定 logger 选型——已用 pino/winston 就复用，都没有默认 pino

---

## Architecture

```
zerou enhance <demo>
  │
  ├─ Step 1: setup worktree (.worktrees/zerou-enhance-<ts>/)
  │    └─ git worktree add + checkout new branch
  │
  ├─ Step 2: 读 .zerou/audit-report.md (上次 audit 结果)
  │    └─ 若无 audit 结果先跑一遍
  │
  ├─ Step 3: 并行规划 (6 个 planner，全只读不改)
  │    ├─ Module A: log-planner       决定 logger lib + 注入点
  │    ├─ Module C: bug-planner       挑可机械修的 finding
  │    ├─ Module D: health-planner    检测无 health endpoint
  │    ├─ Module E: sentry-planner    检测无 error tracker
  │    └─ Module F: env-planner       diff .env.example
  │
  ├─ Step 4: 串行执行 (依赖装包 → AST 改 → 重跑装包)
  │    ├─ B: log-executor    pino + pino-http + middleware + AST 改
  │    ├─ C: bug-patcher     LLM 出 patch + apply + 自检
  │    ├─ D: health-gen      新建 app/health/route.ts
  │    ├─ E: sentry-installer  装 + bootstrap
  │    └─ F: env-completer   .env.example 补
  │
  ├─ Step 5: verification harness (Module G)
  │    ├─ npm install (确保新 dep 装好)
  │    ├─ tsc --noEmit
  │    ├─ user 原 test script (npm test / bun test)
  │    └─ npm run build (Next.js 项目)
  │
  └─ Step 6: Module H 写报告
       └─ .zerou/enhance-report.md：每模块 diff stat + 验证结果 + 用户操作指引
```

---

## 模块契约 (公开 API)

详 `docs/details/12-enhance-public-surface.md`（待写）。简表：

| Module | 输入 | 输出 |
|---|---|---|
| A log-planner | `cwd` + 上次 audit | `InjectionPlan[]` (loggerLib, sites[]) |
| B log-executor | `cwd` + `InjectionPlan[]` | 改了的 file 列表 + 失败列表 |
| C bug-patcher | `cwd` + audit findings | `PatchResult[]` (file, status, diff) |
| D health-gen | `cwd` + framework | `{ added: string \| null }` |
| E sentry-installer | `cwd` + framework | `{ added: string[], dependencies: string[] }` |
| F env-completer | `cwd` | `{ added: string[], existed: string[] }` |
| G verify | `cwd` + scripts | `VerifyResult { tsc, test, build, perModule }` |
| H report | 全部上面 + `cwd` | 写 `.zerou/enhance-report.md` |

---

## Acceptance Checklist (5 行)

1. **目标**：`zerou enhance ./my-app` 在 worktree 里真改完代码 + 跑通验证
2. **不变量**：原 `main` 分支零改动；用户原 test suite 仍绿；改 < N 文件 (cap)
3. **验证命令**：`node cli/bin/zerou.mjs enhance /tmp/phase5-demo && cd .worktrees/zerou-enhance-* && npx tsc --noEmit && npm test`
4. **不做**：① 强制 merge ② 改 main 历史 ③ push 到 remote ④ 删用户文件 ⑤ 装 cc 当 engine
5. **完成标准**：phase5-demo 跑通（log 注入 / pino 装上 / .env 补齐 / verify 全绿）+ agent-game-platform 至少修对 1 个 sitemap bug

---

## SPEC-SPLIT 触发判定

非 trivial 新模块 (>3 文件 / 新公开 API / 复杂状态机) → 走 SPEC-SPLIT：

1. 写 `docs/details/12-enhance-spec.md`（dev doc，全实现细节）
2. 提 `docs/details/12-enhance-public-surface.md`（只 API + 行为契约编号）
3. 派 subagent **黑盒**读 public-surface 写 `12-enhance-tests.md`
4. 比对 `12-enhance-comparison-report.md` 找 surface gap
5. 修 gap → 才进 TEAMWORK 并行实现

本阶段 7+ 个新模块，必须 SPEC-SPLIT。

---

## Expected Outputs

- `cli/src/enhance.ts` (entry + worktree orchestration)
- `cli/src/enhance/{log-planner,log-executor,bug-patcher,health-gen,sentry-installer,env-completer,verify,report}.ts`
- 同名 .test.ts 共 ~50+ 单测
- `docs/details/12-enhance-*.md` SPEC-SPLIT 4 件套
- `presets/observability-missing.md` 的 fix.command 真接进 bug-patcher（不再 echo 提示）
- `cli/bin/zerou.mjs` 加 `enhance` 子命令路由
- README 加 `zerou enhance` 章节

## How To Verify

```bash
# 1. 单测
cd /d/lll/d2p/cli && npx vitest run --config vitest.config.ts

# 2. phase5-demo dogfood
rm -rf /tmp/phase5-demo/.worktrees /tmp/phase5-demo/.zerou
node /d/lll/d2p/cli/bin/zerou.mjs audit /tmp/phase5-demo --no-color --config /tmp/zerou-minimax-cfg.json
node /d/lll/d2p/cli/bin/zerou.mjs enhance /tmp/phase5-demo --no-color --config /tmp/zerou-minimax-cfg.json
ls /tmp/phase5-demo/.worktrees/zerou-enhance-*/   # 应有内容
cat /tmp/phase5-demo/.zerou/enhance-report.md      # 应列改了啥

# 3. agent-game-platform 实战
node /d/lll/d2p/cli/bin/zerou.mjs enhance /d/lll/managed-projects/agent-game-platform --no-color --config /tmp/zerou-minimax-cfg.json
cd /d/lll/managed-projects/agent-game-platform/.worktrees/zerou-enhance-*
git diff main..HEAD -- app/sitemap.xml/route.ts   # 应见 escapeXml/encodeURIComponent 修补
```

## Probes (Gate 1+2 hard-match)

```bash
# Probe 1: phase5-demo 是否生成 pino bootstrap?
test -f /tmp/phase5-demo/.worktrees/zerou-enhance-*/src/logger.ts && echo PASS_PINO
# Probe 2: enhance-report.md 是否含 "Module B" 段?
grep -q "Module B" /tmp/phase5-demo/.zerou/enhance-report.md && echo PASS_REPORT
# Probe 3: agent-game-platform sitemap.xml 是否 line 116 加了 encodeURIComponent?
cd /d/lll/managed-projects/agent-game-platform/.worktrees/zerou-enhance-* && grep -q "encodeURIComponent" app/sitemap.xml/route.ts && echo PASS_SITEMAP_FIX
```

---

## Subagent Dispatch 计划

### Round 1 — SPEC-SPLIT 4 件套 (并行 2 subagent)
- Worker-A: 写 `12-enhance-spec.md` + `12-enhance-public-surface.md`
- Worker-B: **黑盒**只读 public-surface，写 `12-enhance-tests.md`
- Lead: 比对 → 写 `12-enhance-comparison-report.md` → 修 surface gap

### Round 2 — 实现 (并行 4 subagent，写集不重叠)
- Worker-1: Module A + B (log planner + executor)  ~600 LOC
- Worker-2: Module C (bug patcher) + presets fix.command rewire  ~500 LOC
- Worker-3: Module D + E + F (health + sentry + env)  ~600 LOC
- Worker-4: Module G + H (verify + report)  ~400 LOC

### Round 3 — Integration (lead)
- Worker-Lead: enhance.ts entry + bin wiring + 跑 dogfood + 修 integration bug

### Round 4 — Validation (lead + Bash)
- 跑 phase5-demo + agent-game-platform
- 全验证命令通过
- README 更新

---

## Decision-Branch Log Taxonomy

| 前缀 | 谁用 |
|---|---|
| `enhance.start` / `enhance.complete` | 主 orchestrator |
| `enhance.worktree.*` | worktree 创建/复用决策 |
| `enhance.log.planner.*` / `enhance.log.executor.*` | Module A/B |
| `enhance.bug.patcher.*` | Module C |
| `enhance.health.*` / `enhance.sentry.*` / `enhance.env.*` | Module D/E/F |
| `enhance.verify.*` | Module G |
| `enhance.report.*` | Module H |

每个 module 必须打 enter/exit log + 关键决策点 (logBranch)。

---

## Status

```
Phase 10 starts: 2026-05-27
全面 v1, ~2500 LOC, 估 3-4 周
本会话目标: SPEC-SPLIT 4 件套 + Module A/B (log) 真 ship 一个端到端 demo
```
