# Phase 5 — Test Case Generator + Runner + 测试断点 log

> ZeroU 从"安全扫描器"升级到"AI 测试程序员"——读 demo 代码，自动生成测试用例，跑测试，留下"测哪个功能 / 哪步断了 / 为啥"的完整 log 链。

---

## Plan

### Goal

1. **给 demo 自动生成测试用例**：agent 读 demo 的 route / endpoint / function，LLM 为每条生成 test spec（不需要用户写）
2. **跑测试用例（v1 静态）**：LLM 阅读源码 + test spec，判断"这段代码是否满足这个 spec"，给 verdict
3. **测试断点详细 log**：每个 test case 的执行轨迹——extracted by which mechanism、当前如何 run、verdict 是什么、reasoning
4. **集成进 audit**：`zerou audit ./my-app` 时 agent 不只扫 secret，**还自动测每个 endpoint 的预期行为**

### Non-Goals (v1)

- ❌ 不真起 demo 进程跑 HTTP（端口管理 / cleanup / wait-for-ready 复杂度太高，v2 scope）
- ❌ 不接 headless browser e2e（TestSprite 工位，v2+ scope）
- ❌ 不做 mutation testing / property-based testing（v2+ scope）
- ❌ 不动 Phase 1-4 任何代码（只新增 `cli/src/agent/test-*` 模块）

### v1 测试范式：**LLM-as-static-runner**

```
[源码] + [test spec] → LLM judge → verdict + reasoning
```

类似 cross-engine reviewer 对 finding 的判断，但对象是"功能行为"不是"漏洞模式"。

举例：
```typescript
// demo code:
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });
  const user = await db.users.findOne({ email });
  if (!user || user.password !== password) return res.status(401).json({ error: 'invalid' });
  return res.json({ token: generateJWT(user) });
});

// agent-generated test specs:
[
  { id: 'login-1', name: 'missing email → 400', endpoint: 'POST /api/login', input: '{}', expected: 'status 400' },
  { id: 'login-2', name: 'wrong password → 401', endpoint: 'POST /api/login', input: '{email:x,password:wrong}', expected: 'status 401' },
  { id: 'login-3', name: 'plaintext password compare', endpoint: 'POST /api/login', issue: 'compares password without hashing', expected: 'BUG: should use bcrypt.compare' },
]

// agent runs each spec:
login-1 → LLM reads code → 'pass: line 4 returns 400 if !email'
login-2 → LLM reads code → 'pass: line 6 returns 401 on mismatch'
login-3 → LLM reads code → 'fail: line 6 `user.password !== password` is plaintext comparison, security bug'
```

→ 真测出**功能行为 + 安全实践**，不只是 regex 扫描。

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  cli/src/agent/test-*  (Phase 5 新增)                     │
│  ├─ test-case-generator.ts  LLM 读代码生成 test specs     │
│  ├─ test-spec-runner.ts     LLM 判断 spec 是否满足        │
│  ├─ test-result-logger.ts   每个 test case 的细 log        │
│  └─ types.ts                共用类型                       │
├──────────────────────────────────────────────────────────┤
│  集成（修改）                                              │
│  ├─ agent/orchestrator.ts   加 testing 阶段 after preset  │
│  └─ audit.ts                 stdout 报告含 test 结果      │
└──────────────────────────────────────────────────────────┘
```

---

## 模块契约

### `cli/src/agent/types.ts`（追加）

```typescript
export type TestCaseStatus = 'pass' | 'fail' | 'inconclusive' | 'skipped';

export interface TestCaseSpec {
  id: string;                          // <category>-<short-id>，例如 'login-1'
  name: string;                        // 人读名称
  category: 'happy-path' | 'edge-case' | 'security' | 'error-handling' | 'auth' | 'validation';
  scope: {
    type: 'endpoint' | 'function' | 'flow';
    target: string;                    // 'POST /api/login' / 'fn:hashPassword' / 'flow:signup'
    file: string;                      // 源文件路径
    line: number;                      // 1-based
  };
  given: string;                       // 前置条件
  when: string;                        // 触发动作
  then: string;                        // 预期结果
  reasoning: string;                   // 为什么测这条
}

export interface TestCaseResult {
  spec: TestCaseSpec;
  status: TestCaseStatus;
  verdictReason: string;               // LLM 解释
  evidence: {                          // 哪里断了
    file?: string;
    line?: number;
    snippet?: string;                  // 相关代码片段
    expectedBehavior?: string;
    actualBehavior?: string;
  };
  criticFamily: string | null;
  durationMs: number;
}

export interface TestSummary {
  total: number;
  pass: number;
  fail: number;
  inconclusive: number;
  skipped: number;
  byCategory: Record<string, { pass: number; fail: number; inconclusive: number; skipped: number }>;
}
```

### `cli/src/agent/test-case-generator.ts`

```typescript
export interface TestGenOptions {
  cwd: string;
  profile: ProjectProfile;
  logger: TrackLogger;                 // track='agent' scope='test-gen'
  criticConfig: EngineConfig | null;
  criticApiKey: string | null;
  /** Max test cases per endpoint/function (default 5) */
  maxCasesPerTarget?: number;
}

/**
 * 1. 扫源文件找 endpoints / 关键 functions（启发式 + LLM）
 * 2. 对每个 target，调 LLM 生成 N 个 test specs（happy path + edges + security）
 * 3. 返回 spec list
 *
 * Emits:
 * - agent.test-gen.start { profile }
 * - agent.test-gen.targets-extracted { count, names }
 * - agent.test-gen.target.start { target }
 * - agent.test-gen.target.llm-call.start
 * - agent.test-gen.target.llm-call.success/failure { genCount, reason }
 * - agent.test-gen.target.complete { specs: TestCaseSpec[] }
 * - agent.test-gen.complete { totalSpecs }
 */
export async function generateTestCases(opts: TestGenOptions): Promise<TestCaseSpec[]>;
```

### `cli/src/agent/test-spec-runner.ts`

```typescript
export interface TestRunOptions {
  spec: TestCaseSpec;
  cwd: string;
  logger: TrackLogger;                 // track='agent' scope='test-run'
  criticConfig: EngineConfig | null;
  criticApiKey: string | null;
}

/**
 * 1. 读源码 around spec.scope.file:line (±30 行 context)
 * 2. 调 LLM "given this code + this test spec, does the code satisfy it? answer pass/fail/inconclusive + which line and why"
 * 3. 返回 TestCaseResult
 *
 * Emits:
 * - agent.test-run.case.start { specId, name }
 * - agent.test-run.case.context-read { file, lineStart, lineEnd }
 * - agent.test-run.case.llm-call.start
 * - agent.test-run.case.llm-call.success/failure
 * - agent.test-run.case.complete { status, verdictReason, evidence }
 */
export async function runTestCase(opts: TestRunOptions): Promise<TestCaseResult>;

export async function runTestCaseBatch(
  specs: TestCaseSpec[],
  ctx: Omit<TestRunOptions, 'spec'> & { concurrency?: number },
): Promise<{ results: TestCaseResult[]; summary: TestSummary }>;
```

### `cli/src/agent/test-result-logger.ts`

```typescript
/**
 * Per-test detailed logging helpers. Each test case gets a sub-trace under
 * agent track for fine-grained replay.
 *
 * Pattern: for each test case:
 *   1. logTestCaseStart(logger, spec)
 *   2. logTestContextRead(logger, { file, lineRange, snippet })
 *   3. logTestLlmCall(logger, { promptHash, model, ... })
 *   4. logTestResult(logger, result)
 *
 * All decision branches inside use logBranch from Phase 4.
 */
export function logTestCaseStart(...): void;
export function logTestContextRead(...): void;
export function logTestLlmCall(...): void;
export function logTestResult(...): void;
```

---

## Decision-Branch Log Taxonomy (Phase 5 新增)

| 前缀 | 谁用 | 例子 |
|---|---|---|
| `agent.test-gen.*` | test-case-generator | `agent.test-gen.target.extraction-decision` |
| `agent.test-run.*` | test-spec-runner | `agent.test-run.case.llm-verdict-decision` |
| `test.*` | per-test sub-events | `test.assertion-decision` |

---

## Subagent Dispatch — Round 1 (并行)

### Track E — Test Case Generator

- **Worktree**: `.worktrees/track-e-testgen`
- **写集**：`cli/src/agent/{test-case-generator,test-types}.ts` + tests + 在 `agent/types.ts` 追加 TestCaseSpec / TestCaseResult 等
- **依赖**：可读 `cli/src/critic-client.ts`、`cli/src/agent/project-detector.ts`（已 ship）
- **不动**：底座、其他 Phase 5 模块
- **测试**：vitest 单测 + mock-LLM 测覆盖 happy / no-LLM fallback / multi-target

### Track F — Test Spec Runner + Result Logger

- **Worktree**: `.worktrees/track-f-testrunner`
- **写集**：`cli/src/agent/{test-spec-runner,test-result-logger}.ts` + tests
- **依赖**：Track E 的 types（stub 提前写）
- **不动**：generator / 底座
- **测试**：vitest 单测 + 一份"runTestCaseBatch with mocked LLM" 集成测

### 写集不重叠验证

| Track | 写集 |
|---|---|
| E | `agent/test-case-generator.ts` + `agent/test-types.ts` + types.ts 追加 |
| F | `agent/test-spec-runner.ts` + `agent/test-result-logger.ts` |

types.ts 追加部分由 Track E 主写，Track F 用 stub。整合时 lead 合并。

---

## Round 2 — Integration

### Track G — 整合 + Demo（我做）

1. Merge E + F
2. 修 `agent/orchestrator.ts`：在 iteration-loop 后加 test-gen + test-run 阶段
3. 修 `audit.ts`：stdout 报告含 test summary
4. 跑全套 vitest
5. 真 demo：用 MiniMax 跑一个有真实 endpoint 的 demo（v1 用一个 mini Express app fixture）
6. 验证 trace 含 `agent.test-gen.*` + `agent.test-run.*` 完整链路

---

## Acceptance Criteria

- [ ] `zerou audit <path>` 跑完后 stdout 含 test summary 段（如 "Tests: 12 pass / 3 fail / 1 inconclusive"）
- [ ] `.zerou/logs/agent/*/<trace>.jsonl` 含 `agent.test-gen.*` ≥ 5 个 event + `agent.test-run.case.*` ≥ 每个 spec 4 个 event
- [ ] Evidence bundle JSON 含 `testResults: TestCaseResult[]` 段
- [ ] 真 demo with MiniMax：mini Express app fixture，agent 自动抽 endpoints + 生成 specs + 测出至少 1 个 fail 1 个 pass
- [ ] 全套 vitest pass，0 regression（cli ≥ 81 + 新增 ≥ 20）

---

## Verify Commands

```bash
# 1. 单测
cd /d/lll/d2p/cli && npx vitest run --config vitest.config.ts

# 2. Mini Express fixture
mkdir -p /tmp/phase5-demo/src
cat > /tmp/phase5-demo/src/login.ts <<EOF
export async function handleLogin(req: any, res: any) {
  const { email, password } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });
  // BUG: plaintext password compare
  const user = await db.findOne({ email });
  if (!user || user.password !== password) return res.status(401).json({ error: 'invalid' });
  return res.json({ token: 'fake-jwt' });
}
EOF

export ZEROU_OPENAI_COMPAT_KEY="$(cat /d/lll/d2p/.cairn-poc3-keys/mmmkey.txt | tr -d '[:space:]')"
node /d/lll/d2p/cli/bin/zerou.mjs audit /tmp/phase5-demo --no-color --config /tmp/zerou-minimax-cfg.json

# 3. 看 agent test-gen + test-run 决策
node /d/lll/d2p/cli/bin/zerou.mjs trace --last --path /tmp/phase5-demo --filter 'agent.test-*'
```

---

## 工程量估计

| Track | LOC | 工时 |
|---|---|---|
| E generator | 600-900 | 2-3h |
| F runner + logger | 700-1000 | 2-3h |
| G 整合 + demo | 200-400 | 1h |
| **合计** | **~1500-2300** | **5-7h** |

---

## Status

```
Phase 5 starts: 2026-05-26 准备派 Round 1 并行
```
