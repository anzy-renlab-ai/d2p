# Phase 8 — 真执行测试 + 进度报告 + 迭代闭环

> 从"LLM 静态分析输出 JSON"升级到"生成真 .test.ts → vitest 真跑 → coverage → 进度式 markdown 报告 → 失败迭代"。

---

## Goal

兑现"AI 测试程序员"愿景的最后一公里：

1. **AST 分析**每个函数/路由的真实结构（不只是 regex heuristic）
2. **生成真 Vitest .test.ts 文件**（不是 JSON spec）
3. **真跑 vitest** 拿 pass/fail + coverage（line/branch %）
4. **进度式 audit-report.md**——每阶段完成立刻追加章节（用户可 tail -f 看）
5. **失败迭代 loop**——测试挂了 agent diagnose → 改方法 → 重跑（v1 max 3 轮）

## Non-Goals (v1)

- ❌ 不做符号执行 (SMT solver, KLEE-style)
- ❌ 不做 mutation testing (Stryker 已经存在)
- ❌ 不做 property-based test (Hypothesis-style)
- ❌ 不强制 100% branch coverage（"足够高 + 关键路径全覆盖"）
- ❌ 不做 UI/E2E (Playwright 工位)

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  cli/src/agent/  Phase 8 新增                             │
│  ├─ ast-analyzer.ts          TS AST → FunctionInfo[]      │
│  ├─ test-emitter.ts          TestCaseSpec → .test.ts file │
│  ├─ runtime/                                              │
│  │   ├─ vitest-orchestrator.ts   spawn vitest + capture   │
│  │   └─ coverage-parser.ts       parse c8/vitest cov      │
│  ├─ progressive-report.ts    audit-report.md stream writer│
│  └─ iteration-loop-v2.ts     fail → diagnose → retry      │
├──────────────────────────────────────────────────────────┤
│  Wire into audit.ts                                        │
└──────────────────────────────────────────────────────────┘
```

---

## 模块契约

### `agent/ast-analyzer.ts` (Track 8A)

```typescript
export interface FunctionInfo {
  file: string;                       // relative POSIX path
  line: number;                       // 1-based, declaration line
  name: string;                       // 'POST' for Next.js verb, or 'handleLogin'
  kind: 'endpoint' | 'function';
  params: Array<{ name: string; typeHint: string | null }>;
  returnTypeHint: string | null;
  branchCount: number;                // count of if/else/switch/try arms
  hasAsyncCall: boolean;
  hasDatabaseCall: boolean;           // detected via heuristic (db./prisma./sql)
  hasNetworkCall: boolean;            // fetch / axios / http
  sourceSnippet: string;              // full function body, capped 200 lines
}

export function analyzeFunctions(opts: {
  cwd: string;
  maxFiles?: number;
  logger: TrackLogger;
}): Promise<FunctionInfo[]>;
```

Use `typescript` package (`ts.createSourceFile`) to parse, walk AST nodes:
- `FunctionDeclaration` / `ArrowFunction` exported
- count `IfStatement`/`SwitchCase`/`TryStatement` inside
- check for `await`, `db.`/`prisma.`/`sql`, `fetch(`/`axios.`

Emits: `agent.ast.*` events per file analyzed.

### `agent/test-emitter.ts` (Track 8B)

```typescript
export interface EmittedTestFile {
  path: string;                       // <cwd>/tests/__zerou__/<slug>.test.ts
  testCount: number;
  specsCovered: string[];             // TestCaseSpec.id list
  sourceLOC: number;
}

export async function emitVitestTests(opts: {
  specs: TestCaseSpec[];
  functions: FunctionInfo[];          // from ast-analyzer
  cwd: string;
  outDir?: string;                    // default: <cwd>/tests/__zerou__
  logger: TrackLogger;
}): Promise<EmittedTestFile[]>;
```

For each TestCaseSpec, emit a Vitest test:

```typescript
// tests/__zerou__/post-api-login.test.ts
import { describe, it, expect, vi } from 'vitest';

describe('POST /api/login', () => {
  it('rejects empty email with 400', async () => {
    // Mocks
    const mockReq = { json: async () => ({}) };
    // Call (route is hard for static — use http or fixture import)
    const { POST } = await import('../../src/api/login.ts');
    const res = await POST(mockReq as any);
    expect(res.status).toBe(400);
  });
});
```

Use LLM (cross-engine critic) to fill in:
- Mock setup (db / fetch / etc.) — based on FunctionInfo.hasDatabaseCall etc.
- Import path resolution
- Assertion code

Fallback if no LLM: emit a `.test.ts` with `it.todo('<spec.name>')` so vitest sees it but skips.

Emits: `agent.emit.*` events.

### `agent/runtime/vitest-orchestrator.ts` (Track 8C)

```typescript
export interface VitestRunResult {
  exitCode: number;
  testFiles: number;
  pass: number;
  fail: number;
  skipped: number;
  durationMs: number;
  failures: Array<{
    file: string;
    test: string;
    errorMessage: string;
    stack: string;
  }>;
  rawStdout: string;
}

export async function runVitest(opts: {
  cwd: string;
  testDir: string;                   // tests/__zerou__
  withCoverage?: boolean;
  logger: TrackLogger;
  timeoutMs?: number;                // default 120s
}): Promise<VitestRunResult>;

export interface CoverageReport {
  lines: { total: number; covered: number; pct: number };
  branches: { total: number; covered: number; pct: number };
  byFile: Record<string, { lines: number; branches: number; lineCovPct: number }>;
}

export async function parseCoverage(opts: {
  cwd: string;
  coverageDir: string;                // coverage/coverage-summary.json
  logger: TrackLogger;
}): Promise<CoverageReport | null>;
```

Spawn `npx vitest run --config <user-or-default> --reporter=json --coverage <testDir>`:
- Capture stdout JSON → parse
- Read `coverage/coverage-summary.json` → parse

**Critical**: don't pollute user's test setup. Use `--reporter=json --silent --coverage.reporter=json-summary --coverage.reportsDirectory=.zerou/coverage`.

Emits: `agent.vitest.*` events.

### `agent/progressive-report.ts` (Track 8D)

```typescript
export type SectionId =
  | 'profile' | 'checklist' | 'static-findings' | 'verdicts'
  | 'test-suite' | 'test-execution' | 'coverage' | 'action-items';

export class ProgressiveReportWriter {
  constructor(opts: { reportPath: string; logger: TrackLogger });
  
  /** Append a section. Called per phase as it completes. */
  appendSection(id: SectionId, title: string, markdown: string): Promise<void>;
  
  /** Update an existing section (for iteration loop). */
  updateSection(id: SectionId, markdown: string): Promise<void>;
  
  /** Finalize: write summary header + table of contents. */
  finalize(): Promise<void>;
}
```

Writes to `<cwd>/.zerou/audit-report.md`. Each section append:
- File grows by one new `## N. <Title>` heading
- Logs `agent.report.section-appended`
- User can `tail -f` it during audit

Format (final):
```markdown
# ZeroU Audit Report
**Project**: <name>
**Generated**: <iso-ts>
**Status**: completed (12m 34s)

## Summary
- 5 hardening categories scanned
- 23 findings (12 confirmed, 7 false-positive, 4 needs-context)
- 38 tests generated, 28 passed, 8 failed, 2 skipped
- Line coverage: 67% / Branch coverage: 52%

## 1. Project Profile
...

## 2. Audit Checklist
...

(每节由对应阶段 appendSection 写入)
```

### Integration: `agent/iteration-loop-v2.ts` (Track integration / lead)

```typescript
/**
 * v1 iteration loop:
 *   Round 1: emit + run → if fail count > threshold, diagnose + adjust
 *   Round 2: re-emit failed specs with better prompt → re-run
 *   (max 3 rounds; bail if still failing or stable)
 */
export async function iterateUntilStable(opts: {
  initialSpecs: TestCaseSpec[];
  functions: FunctionInfo[];
  cwd: string;
  maxRounds?: number;                  // default 3
  reportWriter: ProgressiveReportWriter;
  logger: TrackLogger;
  ...
}): Promise<IterationOutcome>;
```

简化：v1 不真做 LLM-guided diagnose+adjust，只做"重跑 + 标稳定"。Real diagnose 留 v2。

---

## Decision-Branch Log Taxonomy (Phase 8 新增)

| 前缀 | 谁用 |
|---|---|
| `agent.ast.*` | ast-analyzer |
| `agent.emit.*` | test-emitter |
| `agent.vitest.*` | vitest-orchestrator |
| `agent.coverage.*` | coverage-parser |
| `agent.report.*` | progressive-report |
| `agent.iteration.*` | iteration-loop-v2 |

---

## Subagent Dispatch

### Round 1 — 4 并行

| Track | 范围 | 写集 |
|---|---|---|
| **8A** AST analyzer | typescript 包 AST 解析 | `cli/src/agent/ast-analyzer.ts` + tests |
| **8B** Test emitter | Spec → .test.ts | `cli/src/agent/test-emitter.ts` + tests |
| **8C** Vitest orchestrator | spawn + parse | `cli/src/agent/runtime/vitest-orchestrator.ts` + `coverage-parser.ts` + tests |
| **8D** Progressive report | markdown writer | `cli/src/agent/progressive-report.ts` + tests |

跨 track 协调：8B 用 8A 的 FunctionInfo（stub），整合时 lead 替换。8C/8D 接口独立。

### Round 2 — 整合 (lead)

- merge 4 worktrees
- 写 iteration-loop-v2.ts
- 改 audit.ts：调用顺序 = ast → existing test-gen → emit → runVitest → coverage → report.appendSection
- 跑全套测试 + 真 Vitest demo + 验证 audit-report.md 真 stream

---

## Acceptance Criteria

- [ ] `zerou audit <demo>` 生成 `<demo>/tests/__zerou__/*.test.ts` 真文件
- [ ] 真跑 `vitest run` 出 pass/fail
- [ ] 真有 coverage report（`.zerou/coverage/coverage-summary.json`）
- [ ] `<demo>/.zerou/audit-report.md` 8 个 section 都写入 + 时间戳证明渐进 append（不是一次性）
- [ ] 失败迭代至少 1 round（即使 v1 简化）
- [ ] 新增 cli 测试 ≥ 30 + 0 regression（baseline 155）

---

## Verify Commands

```bash
# 1. 单测
cd /d/lll/d2p/cli && npx vitest run --config vitest.config.ts

# 2. 真 demo (用 phase5-demo or 自造)
export ZEROU_OPENAI_COMPAT_KEY="$(cat /d/lll/d2p/.cairn-poc3-keys/mmmkey.txt | tr -d '[:space:]')"
node /d/lll/d2p/cli/bin/zerou.mjs audit /tmp/phase5-demo --no-color --config /tmp/zerou-minimax-cfg.json

# 3. 看 audit-report.md
cat /tmp/phase5-demo/.zerou/audit-report.md

# 4. 看真生成的 test file
ls /tmp/phase5-demo/tests/__zerou__/*.test.ts
cat /tmp/phase5-demo/tests/__zerou__/*.test.ts | head -50

# 5. 看真 coverage
cat /tmp/phase5-demo/.zerou/coverage/coverage-summary.json
```

---

## Status

```
Phase 8 starts: 2026-05-26 4 并行 subagent
```
