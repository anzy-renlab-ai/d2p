# Phase 4 — Agent Orchestrator + 全决策分支 log

> ZeroU 从"用户挑 preset 的工具箱"升级到"用户敲一行命令的自主机器人"。

---

## Plan

### Goal

1. **零配置自主运行**：`zerou audit <path>` 不带任何 flag、不需 preset 配置，agent 自主导航完整 12 类硬化检查
2. **每个 if/else 都有 log**：用户在 `--verbose` 模式下能看 agent 的完整决策路径
3. **保留底层 framework**：不重写 Preset / Cross-Engine / Evidence Bundle 底座，只在它们之上加 agent orchestrator 层

### Non-Goals

- ❌ 不删除现有 `--preset` 模式（legacy 继续工作）
- ❌ 不动 daemon / log 模块本身（Phase 2 不动）
- ❌ 不重写已 ship 的 Track P1/P2/A
- ❌ 不为"未来可扩展"过度设计——只做当前用例

### 用户体验对比

**Before（当前）**：
```bash
zerou audit ./my-app --config /tmp/zerou-minimax-cfg.json --preset secrets-leak --apply
```

**After（Phase 4）**：
```bash
zerou audit ./my-app
# agent 自主完成所有事
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  cli/src/agent/  (新增 — Phase 4)                         │
│  ├─ project-detector.ts    项目类型识别 (LLM)             │
│  ├─ checklist-builder.ts   该测哪几类 (LLM)               │
│  ├─ detection-strategist.ts 每类怎么测 (LLM 选 preset)    │
│  ├─ fix-strategist.ts      每个 finding 怎么修 (template/LLM)│
│  ├─ iteration-loop.ts      失败诊断 + 重试                │
│  ├─ orchestrator.ts        主入口，串联以上               │
│  └─ types.ts               agent 共用类型                 │
├──────────────────────────────────────────────────────────┤
│  cli/src/log/branch.ts  (新增 — Phase 4)                  │
│  └─ logBranch() helper 强制每个 if/else 发 event          │
├──────────────────────────────────────────────────────────┤
│  cli/src/audit.ts  (修改)                                  │
│  └─ 默认走 orchestrator，--preset flag 走 legacy 路径     │
├──────────────────────────────────────────────────────────┤
│  现有底座 (不动)                                           │
│  ├─ Preset Framework (Track P2)                          │
│  ├─ Cross-Engine Reviewer (Track P1)                     │
│  ├─ Log Module                                            │
│  └─ Evidence Bundle                                       │
└──────────────────────────────────────────────────────────┘
```

---

## 模块契约（subagent 必读）

### `agent/types.ts`

```typescript
export type AuditCategory =
  | 'secrets' | 'auth' | 'authz' | 'db' | 'security'
  | 'observability' | 'error-handling' | 'tests'
  | 'perf' | 'llm-cost' | 'gdpr' | 'deploy-incident';

export interface ProjectProfile {
  framework: string;          // 'next.js' | 'express' | 'unknown' | ...
  backend: string | null;     // 'supabase' | 'firebase' | 'custom' | null
  language: string[];         // ['typescript', 'sql']
  hasGit: boolean;
  hasTests: boolean;          // detected via package.json scripts
  hasEnvFile: boolean;        // .env or .env.example present
  packageMgr: 'npm' | 'pnpm' | 'yarn' | null;
  evidence: Record<string, string>;  // raw findings backing the inference
}

export interface ChecklistItem {
  category: AuditCategory;
  priority: 'high' | 'medium' | 'low' | 'skip';
  reasoning: string;
  presetIds: string[];        // which existing preset(s) map to this category
}

export interface AgentDecision {
  ts: number;
  step: string;               // e.g. 'project-detection' | 'checklist-build' | 'detection-strategy'
  decision: string;           // e.g. 'use-preset' | 'skip' | 'llm-judgment'
  reasoning: string;
  evidence?: unknown;
}
```

### `agent/project-detector.ts`

```typescript
export interface DetectorOptions {
  cwd: string;
  logger: TrackLogger;       // track='agent'
  criticConfig: EngineConfig | null;
  criticApiKey: string | null;
}

/**
 * Reads README, package.json, deps list, lightweight file structure.
 * Asks critic LLM to infer project profile.
 * Falls back to deterministic heuristics if no LLM available.
 *
 * Emits:
 * - agent.project-detection.start
 * - agent.project-detection.files-read { count, names: string[<=20] }
 * - agent.project-detection.llm-call.start (if LLM available)
 * - agent.project-detection.llm-call.success/failure
 * - agent.project-detection.heuristic-fallback (if no LLM or LLM failed)
 * - agent.project-detection.complete { profile }
 */
export async function detectProject(opts: DetectorOptions): Promise<ProjectProfile>;
```

### `agent/checklist-builder.ts`

```typescript
export interface ChecklistOptions {
  profile: ProjectProfile;
  availablePresets: LoadedPreset[];
  logger: TrackLogger;
  criticConfig: EngineConfig | null;
  criticApiKey: string | null;
}

/**
 * Asks critic LLM: "given this project profile + these available presets, which
 * categories should we test and at what priority?"
 *
 * Returns a checklist with priority + reasoning per category.
 * Skipped categories explicitly listed (so log shows why they were skipped).
 *
 * Emits:
 * - agent.checklist.start { profile-summary }
 * - agent.checklist.llm-call.success/failure
 * - agent.category.included { category, priority, reasoning }
 * - agent.category.skipped { category, reasoning }
 * - agent.checklist.complete { included-count, skipped-count }
 */
export async function buildChecklist(opts: ChecklistOptions): Promise<ChecklistItem[]>;
```

### `agent/detection-strategist.ts`

```typescript
export interface StrategyOptions {
  item: ChecklistItem;
  profile: ProjectProfile;
  availablePresets: LoadedPreset[];
  logger: TrackLogger;
  criticConfig: EngineConfig | null;
  criticApiKey: string | null;
}

export interface DetectionStrategy {
  approach: 'use-preset' | 'preset-modified' | 'llm-judgment';
  presetIds: string[];           // which presets to run
  promptOverride?: string;       // when approach === 'llm-judgment'
  reasoning: string;
}

/**
 * For each checklist item, decides HOW to detect.
 * - If a preset matches the project well → use-preset
 * - If a preset's filePattern needs adjustment → preset-modified (future scope; v1 just use-preset)
 * - If no preset fits → llm-judgment (future scope; v1 returns 'use-preset' or 'skip')
 *
 * v1 SCOPE: pick the best preset (or none) for each category. Skip categories
 * with no preset coverage. Mark them 'skip-no-preset' in log.
 *
 * Emits:
 * - agent.strategy.start { category }
 * - agent.strategy.preset-matched { category, presetId, reasoning }
 * - agent.strategy.skip-no-preset { category, reasoning }
 * - agent.strategy.complete { strategy }
 */
export async function chooseStrategy(opts: StrategyOptions): Promise<DetectionStrategy>;
```

### `agent/fix-strategist.ts`

```typescript
export interface FixStrategyOptions {
  finding: VerdictedFinding;
  preset: LoadedPreset;
  cwd: string;
  logger: TrackLogger;
  criticConfig: EngineConfig | null;
  criticApiKey: string | null;
}

export interface FixStrategy {
  approach: 'template' | 'llm-only' | 'manual-only';
  reasoning: string;
}

/**
 * For each confirmed finding, decides HOW to fix.
 * v1 SCOPE:
 *   - If preset has template AND finding is straightforward → template
 *   - If preset is llm-only → llm-only
 *   - If verdict is 'needs-context' → manual-only (skip)
 *   - If verdict is 'false-positive' → never called
 *
 * Emits:
 * - agent.fix-strategy.start { findingId }
 * - agent.fix-strategy.template-chosen { findingId, reasoning }
 * - agent.fix-strategy.llm-chosen { findingId, reasoning }
 * - agent.fix-strategy.manual-required { findingId, reasoning }
 */
export async function chooseFixStrategy(opts: FixStrategyOptions): Promise<FixStrategy>;
```

### `agent/iteration-loop.ts`

```typescript
export interface IterationOptions {
  checklist: ChecklistItem[];
  profile: ProjectProfile;
  cwd: string;
  presets: LoadedPreset[];
  logger: TrackLogger;
  criticConfig: EngineConfig | null;
  criticApiKey: string | null;
  applyMode: boolean;            // user passed --apply
}

export interface IterationResult {
  decisions: AgentDecision[];
  findings: VerdictedFinding[];
  applied: { findingId: string; method: 'template' | 'llm'; verified: boolean }[];
  skipped: { findingId: string; reason: string }[];
  iterations: number;
}

/**
 * Main loop:
 *   for each checklist item with priority != 'skip':
 *     strategy = chooseStrategy(item)
 *     if strategy.approach == 'skip-no-preset': log + continue
 *     findings = runPreset(strategy.presetIds, ...)
 *     verdicts = reviewBatch(findings, criticPolicy)
 *     for each confirmed verdict + applyMode:
 *       fix = chooseFixStrategy(verdict)
 *       apply + verify
 *       if not verified: diagnose, retry (v1: skip with reason)
 *
 * Emits:
 * - agent.iteration.start { totalItems }
 * - agent.iteration.item.start { category }
 * - agent.iteration.item.complete { category, findings, applied, skipped }
 * - agent.iteration.complete { totalIterations }
 */
export async function runIterationLoop(opts: IterationOptions): Promise<IterationResult>;
```

### `agent/orchestrator.ts`

```typescript
export interface OrchestratorOptions {
  cwd: string;
  config: ResolvedConfig;
  logger: TrackLogger;          // root cli logger; orchestrator creates child agent logger
  applyMode: boolean;
  logRoot: string;
}

export interface OrchestratorResult {
  profile: ProjectProfile;
  checklist: ChecklistItem[];
  iterationResult: IterationResult;
  evidenceBundle: EvidenceBundle;
}

/**
 * Top-level entry. Wires:
 *   detectProject() → buildChecklist() → runIterationLoop() → produce bundle.
 *
 * All under track='agent' with shared trace.
 */
export async function runOrchestrator(opts: OrchestratorOptions): Promise<OrchestratorResult>;
```

### `log/branch.ts`

```typescript
/**
 * Forced decision-branch logging helper. Use at EVERY if/else / switch / try/catch
 * in code that the user might want to trace.
 *
 * Convention: event name 'scope.decision-point.outcome'.
 *   e.g. 'preset.file.scan-decision' with outcome 'scan' | 'skip'
 *
 * The helper itself emits at debug level by default, but escalates to info if
 * the decision is consequential (caller passes level option).
 */
export function logBranch(
  logger: TrackLogger,
  event: string,
  data: {
    decision: string;
    reasoning?: string;
    [k: string]: unknown;
  },
  opts?: { level?: 'debug' | 'info' },
): void;
```

---

## Decision-Branch Log Taxonomy

每个层都有自己的 event 前缀：

| 前缀 | 谁用 | 例子 |
|---|---|---|
| `agent.project-detection.*` | project-detector | `agent.project-detection.heuristic-fallback` |
| `agent.checklist.*` | checklist-builder | `agent.checklist.category.included` |
| `agent.strategy.*` | detection-strategist | `agent.strategy.preset-matched` |
| `agent.fix-strategy.*` | fix-strategist | `agent.fix-strategy.template-chosen` |
| `agent.iteration.*` | iteration-loop | `agent.iteration.item.start` |
| `preset.file.*` | sweep existing | `preset.file.scan-decision` |
| `preset.regex.*` | sweep existing | `preset.regex.compile-decision` |
| `critic.parse.*` | sweep existing | `critic.parse.think-block-detected` |
| `cli.config.*` | sweep existing | `cli.config.legacy-fallback-decision` |

---

## Subagent Dispatch (Round 1 — 并行)

### Track A — Project Detector + Checklist Builder

- **Worktree**: `.worktrees/track-a-detector`
- **写集**：`cli/src/agent/project-detector.ts`、`agent/checklist-builder.ts`、`agent/types.ts`、对应 tests
- **依赖**：可以读 `cli/src/critic-client.ts`（已有）
- **不动**：底座、其他 agent/* 模块
- **测试**：vitest 单测 + 一份 mock-LLM 测覆盖 happy path 和 LLM-unavailable 兜底

### Track B — Strategist + Loop + Orchestrator

- **Worktree**: `.worktrees/track-b-loop`
- **写集**：`cli/src/agent/detection-strategist.ts`、`fix-strategist.ts`、`iteration-loop.ts`、`orchestrator.ts`、tests
- **依赖**：Track A 的 types.ts（stub 提前写在 worktree）
- **不动**：底座、Track A 的实现细节
- **测试**：vitest 单测 + 一份完整 mock 流水线测

### Track C — Decision-Branch Logger Sweep

- **Worktree**: `.worktrees/track-c-branch-log`
- **写集**：`cli/src/log/branch.ts` 新增；扫现有代码（stubs.ts、critic-client.ts、audit.ts、apply.ts、report.ts、config.ts、repo.ts、evidence-bundle.ts、trace.ts）每个 if/else 加 `logBranch()` 调用
- **不动**：业务逻辑（只加 log 不改控制流）
- **测试**：vitest 单测 + 一份 verify "跑一次 audit 后 .zerou/logs 含 agent.* + preset.file.* + critic.parse.* 各 ≥3 个 event"

### 写集不重叠验证

| Track | 主要写文件 |
|---|---|
| A | `cli/src/agent/{project-detector,checklist-builder,types}.ts` + tests |
| B | `cli/src/agent/{detection-strategist,fix-strategist,iteration-loop,orchestrator}.ts` + tests |
| C | `cli/src/log/branch.ts` + 现有文件的 `logBranch()` 插入 |

**冲突点**：
- A 的 `agent/types.ts` 被 B 读 → B worktree 用 stub，整合时合并
- C 改 existing files 同时 A/B 不改 existing files → 无冲突
- 三者都不动 daemon/ → 安全

---

## Round 2 — Integration (sequential)

### Track D — 整合 + Smoke

- **运行时机**：A + B + C 全部完成后
- **任务**：
  1. Merge 3 worktree 到 main
  2. 合并 `agent/types.ts` 的 stub 跟真版
  3. 改 `cli/src/audit.ts`：当无 `--preset` flag 时走 `runOrchestrator`
  4. 跑全套 vitest（daemon + cli）确认无 regression
  5. 跑端到端真 demo：
     - `zerou audit /tmp/zerou-demo`（前面 6-finding fixture）—— 预期 agent 自主导航
     - `zerou audit /d/lll/managed-projects/agent-game-platform` —— 预期 agent 自主跑完所有 12 类
     - 跑 `zerou trace --last --path <p>` 确认每个 if/else 都有 log
  6. 写 evidence demo 给 user

---

## Acceptance Criteria

下列全部满足才算 Phase 4 完成：

- [ ] `zerou audit <path>` 不带 flag 跑通，agent 自主决定测哪几类
- [ ] `.zerou/logs/agent/<date>/<trace>.jsonl` 真生成，含 `agent.project-detection.complete`、`agent.checklist.complete`、`agent.iteration.complete` 各至少 1 条
- [ ] `.zerou/logs/preset/<date>/<trace>.jsonl` 含 `preset.file.scan-decision` 至少 5 条（一些 scan 一些 skip 都有）
- [ ] `.zerou/logs/critic/<date>/<trace>.jsonl` 含 `critic.parse.*` decision 路径 log
- [ ] 全套 vitest pass（daemon ≥ 442 + cli 新增 ≥ 30 新测试，0 regression）
- [ ] 真 demo：跑 `/tmp/zerou-demo` 6-finding fixture，agent 自主判定 secrets 类需要测，跑 critic 验证，输出 6 verdict
- [ ] 真 demo：跑 `agent-game-platform` 项目，agent 自主决定测哪几类，输出 evidence bundle

---

## Verify Commands

```bash
# 1. 单测全过
cd /d/lll/d2p/daemon && npx vitest run --config vitest.config.ts
cd /d/lll/d2p/cli && npx vitest run --config vitest.config.ts

# 2. 6-finding fixture 端到端
export ZEROU_OPENAI_COMPAT_KEY="$(cat /d/lll/d2p/.cairn-poc3-keys/mmmkey.txt | tr -d '[:space:]')"
node /d/lll/d2p/cli/bin/zerou.mjs audit /tmp/zerou-demo --no-color --config /tmp/zerou-minimax-cfg.json

# 3. agent decision path verbatim
node /d/lll/d2p/cli/bin/zerou.mjs trace --last --path /tmp/zerou-demo --filter 'agent.*'

# 4. 真项目跑（无 --preset flag）
node /d/lll/d2p/cli/bin/zerou.mjs audit /d/lll/managed-projects/agent-game-platform --no-color --config /tmp/zerou-minimax-cfg.json
```

期望输出：
- 6-finding fixture：agent 决策"测 secrets 类"，跑 secrets-leak preset，MiniMax 复核 6 个 finding 给 verdict
- agent-game-platform：agent 决策"测 secrets + supabase-rls 两类"（项目类型识别为 Next.js+Supabase），跑两个 preset，无 finding（清洁项目）

---

## 工程量估计

| Track | LOC 估 | 工时 估 |
|---|---|---|
| A | 600-800 | 1-2h |
| B | 1000-1500 | 2-3h |
| C | 300-500 + sweep ~20 文件 | 1-2h |
| D 整合 | 200-400 + 跑测试 + demo | 1-2h |
| **合计** | **~2100-3200 LOC** | **5-9h** |

---

## Risk

| 风险 | 缓解 |
|---|---|
| LLM 不可用（offline / no key）时 agent 卡住 | 每个 LLM 调用必有 deterministic fallback；project-detector 用规则推断；checklist 用默认 priority |
| Agent 决策错（漏掉重要类）| Phase 4 v1 接受"under-coverage"，下个版本加 feedback loop |
| Sweep existing 加 logBranch 引入回归 | 三个 worktree 不动业务逻辑，只加 log；vitest 全套不下降确认 |
| Subagent 误读 surface 写错接口 | 用 mock-LLM 测试 + 整合时跑全套 tests |

---

## Status

```
Phase 4 starts: 2026-05-26
Subagent dispatch: Round 1 即将开始
Sequential integration: Round 2 等 Round 1 全完成
```
