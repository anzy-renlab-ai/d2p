# Phase 6 + 7 — 真运行时测试 + 11 类 hardening preset

> Phase 6: 让 ZeroU 真启动 demo 跑 HTTP 测试（不只是 LLM 静态分析）
> Phase 7: 把当前 1 类 secrets preset 补齐到 12 类硬化全覆盖

---

## Phase 6 — Runtime Test Runner

### Goal

之前 Phase 5 是 LLM-as-static-analyst（看代码判断）。Phase 6 是 LLM-as-runtime-tester（**真启 demo 跑 HTTP，验真行为**）。

```
当前 (Phase 5):
  spec → LLM 读源码 → 静态判 pass/fail
  
Phase 6:
  spec → 启 demo 进程 → 等端口 → 发 HTTP → 比 actual vs expected → pass/fail
```

### Non-Goals (v1)

- ❌ 不做 headless browser (Playwright/Puppeteer)
- ❌ 不做 Python / Go / Rust runtime（仅 Node.js）
- ❌ 不做并发 spec 跑（v1 串行）
- ❌ 不做 mock / fake server fixture

### v1 范围

支持的项目类型：
- ✅ Next.js app (`next dev` / scripts.dev = next dev / next start)
- ✅ Express / Koa / Fastify (`node server.js`, `tsx server.ts`, scripts.dev)
- ✅ Vite (`vite` / `vite dev`)
- ❌ Static-only sites (no server)

支持的测试类型：
- HTTP endpoint: GET / POST / PUT / DELETE / PATCH
- 检查: status code, response body shape (JSON match), response headers

### 模块契约

#### `cli/src/agent/runtime/types.ts`

```typescript
export type RuntimeStrategy =
  | 'next-dev'        // npm/pnpm/yarn dev (Next.js)
  | 'next-start'      // npm/pnpm/yarn start (Next.js prod)
  | 'node-script'     // node <file>, scripts.start
  | 'vite-dev'        // vite / vite dev
  | 'unknown';

export interface DetectedRuntime {
  strategy: RuntimeStrategy;
  command: string;          // 'pnpm dev'
  args: string[];           // ['dev']
  expectedPort: number;     // 3000 (Next default), 5173 (Vite), etc.
  readyTimeoutMs: number;   // 30_000
  envVars: Record<string, string>;
}

export interface RuntimeProcess {
  pid: number;
  port: number;
  baseUrl: string;
  startTime: number;
  kill: () => Promise<void>;
}

export interface HttpTestSpec {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;              // '/api/login'
  headers?: Record<string, string>;
  body?: unknown;
  expectedStatus?: number;
  expectedBodyShape?: unknown;  // JSON contains assertions
}

export interface HttpTestResult {
  spec: HttpTestSpec;
  status: 'pass' | 'fail' | 'inconclusive';
  actualStatus?: number;
  actualBody?: unknown;
  actualHeaders?: Record<string, string>;
  verdictReason: string;
  durationMs: number;
}
```

#### `cli/src/agent/runtime/runtime-detector.ts`

```typescript
/**
 * Reads package.json, detects which runtime strategy applies.
 * Returns null if no Node.js runtime detected.
 *
 * Emits:
 * - agent.runtime.detect.start
 * - agent.runtime.detect.package-json-found / not-found
 * - agent.runtime.detect.strategy-decision { strategy, reason }
 * - agent.runtime.detect.complete { runtime }
 */
export async function detectRuntime(cwd: string, logger: TrackLogger): Promise<DetectedRuntime | null>;
```

#### `cli/src/agent/runtime/process-launcher.ts`

```typescript
/**
 * Launches the demo process, waits for port to be listening, returns handle.
 *
 * Strategy:
 *   1. spawn child process detached
 *   2. capture stdout/stderr for log
 *   3. poll port (net.connect localhost:port) every 500ms up to readyTimeoutMs
 *   4. on ready → resolve RuntimeProcess
 *   5. on timeout / crash → reject + cleanup
 *
 * Emits:
 * - agent.runtime.launch.start { command, args }
 * - agent.runtime.launch.stdout / stderr (debug level, truncated)
 * - agent.runtime.launch.port-poll { port, attempt }
 * - agent.runtime.launch.ready { port, durationMs }
 * - agent.runtime.launch.timeout / crash
 */
export async function launchRuntime(detected: DetectedRuntime, cwd: string, logger: TrackLogger): Promise<RuntimeProcess>;
```

#### `cli/src/agent/runtime/http-tester.ts`

```typescript
/**
 * Sends one HTTP request, compares with expected, returns HttpTestResult.
 *
 * Emits:
 * - agent.runtime.http.request.start { method, path, baseUrl }
 * - agent.runtime.http.response { status, durationMs, bodyPreview }
 * - agent.runtime.http.assert.status-decision { expected, actual, pass }
 * - agent.runtime.http.assert.body-decision { match, mismatchPath }
 * - agent.runtime.http.complete { status, verdictReason }
 */
export async function runHttpTest(spec: HttpTestSpec, runtime: RuntimeProcess, logger: TrackLogger): Promise<HttpTestResult>;
```

#### `cli/src/agent/runtime/spec-to-http.ts`

```typescript
/**
 * Converts TestCaseSpec (from Phase 5) into HttpTestSpec where possible.
 * Uses LLM if available; falls back to heuristic mapping.
 *
 * Returns null when spec is not testable via HTTP (e.g., pure function tests).
 */
export async function specToHttpTest(spec: TestCaseSpec, opts: { logger; criticConfig; criticApiKey }): Promise<HttpTestSpec | null>;
```

#### `cli/src/agent/runtime/index.ts`

```typescript
/**
 * Top-level: take TestCaseSpec[], detect runtime, launch, run HTTP tests,
 * cleanup. Returns runtime TestCaseResult[] using same shape as Phase 5
 * static results (caller transparently merges).
 */
export async function runRuntimeTests(
  specs: TestCaseSpec[],
  cwd: string,
  opts: { logger; criticConfig; criticApiKey; logRoot? }
): Promise<{ results: TestCaseResult[]; runtime: RuntimeProcess | null }>;
```

### v1 工程量

预计 1000-1500 LOC：
- runtime-detector: 200 LOC + tests
- process-launcher: 300 LOC + tests
- http-tester: 200 LOC + tests
- spec-to-http: 250 LOC + tests
- index (orchestration): 150 LOC + tests

---

## Phase 7 — 11 类 hardening preset

### Goal

Phase 4 当前内置 preset：
- ✅ secrets-leak (8 rules) — 类 1
- ✅ supabase-rls (1 rule) — 类 4 部分

要补完 12 类，按 Fiverr cleanup specialist 标准模板：

| # | 类 | 现状 | 补什么 |
|---|---|---|---|
| 1 | secrets | ✅ 8 rules | 不动 |
| 2 | **auth** | ❌ | 加 preset |
| 3 | **authz / BOLA** | ❌ | 加 preset |
| 4 | db | ⚠️ supabase only | 扩展 |
| 5 | **security (CORS / CSP)** | ❌ | 加 preset |
| 6 | **observability** | ❌ | 加 preset |
| 7 | **error-handling** | ❌ | 加 preset |
| 8 | **tests** | ❌ | 加 preset |
| 9 | **perf** | ❌ | 加 preset |
| 10 | **llm-cost** | ❌ | 加 preset |
| 11 | **gdpr** | ❌ | 加 preset |
| 12 | **deploy-incident** | ❌ | 加 preset |

### Preset 文件格式

参考 `presets/secrets-leak.md`：

```markdown
---
id: <preset-id>
version: 2
name: <Preset Name>
appliesTo: []
rules:
  - ruleId: <rule-id>
    label: <description>
    severity: P1|P2|P3
    mechanism: static-grep|file-exists|llm-judgment
    source: <preset-id>/v2
    rationale: <why this matters>
    detection:
      pattern: <regex>
      filePattern: <glob>
    fix:
      kind: template|llm-only
      command: <shell or codemod>
      verifyCommand: <command exits 0 if fix succeeded>
---

# <Preset name>

<Human readable explanation>

## Remediation

<Step-by-step fix guidance>
```

### 11 个 preset 文件清单

| File | Mechanism mix | Min rules |
|---|---|---|
| `presets/auth-weakness.md` | static-grep + llm-judgment | 3 |
| `presets/authz-bola.md` | static-grep + llm-judgment | 3 |
| `presets/db-injection.md` | static-grep + llm-judgment | 3 |
| `presets/security-cors-csp.md` | static-grep + file-exists | 4 |
| `presets/observability-missing.md` | static-grep + llm-judgment | 3 |
| `presets/error-handling.md` | static-grep + llm-judgment | 3 |
| `presets/tests-missing.md` | file-exists + static-grep | 3 |
| `presets/perf-issues.md` | static-grep + llm-judgment | 3 |
| `presets/llm-cost-uncapped.md` | static-grep + llm-judgment | 2 |
| `presets/gdpr-compliance.md` | static-grep + file-exists | 3 |
| `presets/deploy-incident.md` | file-exists + static-grep | 3 |

共 ~30+ 规则。

### 内置 preset 注册

修 `cli/src/agent/orchestrator.ts` 的 preset list：
```typescript
// before
const BUILTIN_PRESETS = [HARDCODED_KEY_PRESET, HARDCODED_SUPABASE_RLS_PRESET];

// after
const BUILTIN_PRESETS = [
  HARDCODED_KEY_PRESET,
  HARDCODED_SUPABASE_RLS_PRESET,
  ...loadBuiltinPresetMarkdownFiles(),  // 新加：从 presets/ 目录扫所有 .md
];
```

但 v1 简化：**先做 `presets/*.md` 文件 + 写一个 loader 从 markdown 解析**。orchestrator 加 markdown loader 调用。

### Phase 7 工程量

预计 ~1500-2000 LOC：
- 11 个 markdown 文件 × 平均 50 行 ~ 550 行 markdown
- markdown parser + loader: 300 LOC + tests
- orchestrator 集成: 50 LOC

---

## Subagent Dispatch

### Round 1 — 并行（4 subagent）

| Track | 名 | 范围 | 写集 |
|---|---|---|---|
| **R** | Runtime Test Runner | Phase 6 全部 | `cli/src/agent/runtime/**/*` |
| **P-A** | Preset Group A (3 个) | auth + authz + security | `presets/auth-weakness.md` + `authz-bola.md` + `security-cors-csp.md` |
| **P-B** | Preset Group B (4 个) | db + observability + error-handling + tests | `presets/db-injection.md` + `observability-missing.md` + `error-handling.md` + `tests-missing.md` |
| **P-C** | Preset Group C (4 个) | perf + llm-cost + gdpr + deploy-incident | `presets/perf-issues.md` + `llm-cost-uncapped.md` + `gdpr-compliance.md` + `deploy-incident.md` |

### Round 2 — 整合（lead 做）

- merge R + P-A + P-B + P-C
- 加 markdown preset loader 到 orchestrator
- 跑全套 vitest
- 真 demo：在 phase5-demo 上跑 + 新加一个 Express server 触发 runtime tests
- 报告

---

## Acceptance Criteria

- [ ] **Phase 6**: `zerou audit ./express-fixture` 真起 Express 进程 + 跑 HTTP 测试 + 报告含 runtime test results + log 含 `agent.runtime.*` 事件 ≥ 8 个
- [ ] **Phase 7**: `presets/` 目录有 12 个 markdown 文件（1 secrets + 1 supabase + 11 新）
- [ ] **Phase 7**: orchestrator 自动加载所有 markdown preset，agent checklist 能选到任一类
- [ ] **测试**: cli ≥ 116 + Phase 6/7 新增 ≥ 30 个 vitest 测试
- [ ] **0 regression**

---

## Verify Commands

```bash
# 1. 单测
cd /d/lll/d2p/cli && npx vitest run --config vitest.config.ts

# 2. Phase 6 真启 Express 跑 HTTP 测试
mkdir -p /tmp/phase6-demo
cat > /tmp/phase6-demo/package.json <<EOF
{"name":"phase6","scripts":{"dev":"node server.js"}}
EOF
cat > /tmp/phase6-demo/server.js <<EOF
const http = require('http');
http.createServer((req, res) => {
  if (req.url === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const { email } = JSON.parse(body || '{}');
      if (!email) { res.statusCode = 400; res.end(JSON.stringify({error:'email required'})); return; }
      res.end(JSON.stringify({ token: 'fake' }));
    });
  } else { res.statusCode = 404; res.end('not found'); }
}).listen(3000, () => console.log('listening on 3000'));
EOF

export ZEROU_OPENAI_COMPAT_KEY="$(cat /d/lll/d2p/.cairn-poc3-keys/mmmkey.txt | tr -d '[:space:]')"
node /d/lll/d2p/cli/bin/zerou.mjs audit /tmp/phase6-demo --no-color --config /tmp/zerou-minimax-cfg.json

# 应看到: Tests: X pass / Y fail, 含真 HTTP 测试

# 3. Phase 7 看 preset 列表
ls /d/lll/d2p/presets/
# 应有 12 个 .md
```

---

## Status

```
Phase 6 + 7 双轨并行启动: 2026-05-26
4 subagents in parallel
```
