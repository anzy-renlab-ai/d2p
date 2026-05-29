# 09 — Config Files

> 三个层级的配置：全局（`~/.zerou/`）、per-demo（`<demo>/.zerou/`）、preset library（`presets/`）。
> 全部明文（JSON / YAML / Markdown）方便检查。

## Global

### `~/.zerou/state.db`

SQLite。详 03-storage.md。

### `~/.zerou/daemon.pid`

```
12345
```

只有 pid 一行。`zerou start` 写、`zerou stop` 删；daemon crash 后下次 `zerou start` 检测 pid 不存活就覆盖。

### `~/.zerou/daemon.log`

Daemon stdout/stderr 重定向到这里。append-only，按日 rotate (`daemon.log.2026-05-12`)。MVP-0 不限大小，运维由用户。

### `~/.zerou/config.json` (可选)

```jsonc
{
  "daemonPort": 5174,
  "uiPort": 5173,
  "uiOrigin": "http://localhost:5173",
  "claudeBin": "claude",           // override path; default looks up PATH
  "gitBin": "git",
  "logRetentionDays": 90,          // MVP-1+
  "models": {
    "haiku": "claude-haiku-4-5-20251001",
    "sonnet": "claude-sonnet-4-6",
    "opus": "claude-opus-4-7"
  }
}
```

读取顺序：env var > config.json > 内置默认。env var 命名迁移期混用 `D2P_*`（旧 daemon vars，如 `D2P_DAEMON_PORT`/`D2P_GIT_BIN`/`D2P_PRESETS_DIR`）与 `ZEROU_*`（新加 vars，如 `ZEROU_LOG_LEVEL`）。新代码用 `ZEROU_*`。

## Per-demo

存放于 `<demo>/.zerou/`：

```
<demo>/
├── .git/
├── ... (用户的代码)
└── .zerou/
    ├── vision.md
    ├── check-commands.yaml
    ├── preset-overrides.yaml
    ├── session-summary.md         # 仅在 ENDED 后生成
    └── gap-history.json
```

`<demo>/.gitignore` 第一次 ZeroU 进入时 daemon 自动追加（若未含）：
```
# ZeroU artifacts
.zerou/
```

注意 `.zerou-worktrees/` 在 demo **父目录** 下（`<demoParent>/.zerou-worktrees/`），不在 demo 仓库内，所以不进 demo 的 gitignore。

### `<demo>/.zerou/vision.md`

由 vision elicitor finalize 后写入。例：

```markdown
# Vision: my-saas-demo

## 产品定位
让小团队管理项目工时与开票的轻量 SaaS。

## 目标用户
3-15 人小型咨询 / 设计工作室；老板亲自看仪表盘。

## 核心场景
- 团队成员每日填工时（手机端 / 桌面端）
- 项目经理审核工时
- 月末自动生成 PDF 发票并发邮件

## 商业模式
免费版 5 人以内；付费 $10/seat/月。

## KPI
- 30 日 retention > 40%
- 月末发票生成失败率 < 1%

## 明确不做
- 不做工资发放
- 不做集成 Slack / Teams
- 不做企业级 SSO（MVP-0）
```

格式约束：6 节固定（`产品定位` / `目标用户` / `核心场景` / `商业模式` / `KPI` / `明确不做`）；缺节 daemon 写入时 warn 但不阻塞。

### `<demo>/.zerou/check-commands.yaml`

```yaml
build: npm run build
test: npm test
typecheck: tsc --noEmit
```

未填 → daemon 用 detector 出的 `inferredCheckCommands`。
显式空字符串 → 跳过此项（视为 PASS，不阻 alignment）。

格式：仅这三个 key，扩展先不支持。

约束：值通过 `shell-quote` 解析，不能含 `;` `|` `&&` `||` `>` `<`。binary 须在 worktree 的 `node_modules/.bin` 或 PATH。

### `<demo>/.zerou/preset-overrides.yaml`

```yaml
add:
  - slug: oauth-google
    category: auth
    description: 支持 Google OAuth 登录
    severity: P2
remove:
  - tests-unit
skip:
  - deploy-config
```

详 07-presets.md §"Override 文件格式"。

### `<demo>/.zerou/session-summary.md`

`/api/session/end` 触发生成。例：

```markdown
# Session Summary — my-saas-demo

- Session ID: 17
- Started: 2026-05-12 14:23
- Ended: 2026-05-12 17:35
- Duration: 3h 12min
- Status: DONE

## Stats
- Gaps closed: 28
- Gaps skipped: 1
- Gaps NEED_HUMAN: 6
- Commits: 47
- Cost: ≈ $128.40 (input 12.4M tok / output 0.8M tok)

## Closed Gaps
- ✓ auth-signup (P1, attempt 1)
- ✓ auth-login (P1, attempt 1)
- ✓ tests-smoke (P1, attempt 2)
- ...

## NEED_HUMAN Gaps
- ⚠ db-migration-prod-strategy
  Reason: ARCHITECTURAL — needs human decision on blue/green vs in-place
- ⚠ payment-webhook-retry
  Reason: TOO_HARD after 3 attempts
- ...

## Vision Verdict
satisfied: true
rationale: ...

## Preset Final Status
saas-web: 30/32 done, 2 skipped (deploy-config user-skipped, oauth-google user-removed)
```

### `<demo>/.zerou/gap-history.json`

Append-only audit log：

```json
[
  {
    "ts": 1747006811000,
    "sessionId": 17,
    "gapId": 42,
    "slug": "auth-signup",
    "status": "DONE",
    "attempts": 1,
    "commit": "abc1234",
    "category": "auth",
    "severity": "P1"
  }
]
```

每个 gap 终态时追加一条。

## Preset Library

详 07-presets.md。位置：`presets/<type>.md`。

## YAML / JSON parser

- YAML：`yaml@2`（safe by default）
- JSON：原生 `JSON.parse`
- Markdown frontmatter：`gray-matter`

## Schema 校验

所有 YAML / JSON 读入时走 `zod` schema。校验失败：

```ts
const result = PresetOverridesSchema.safeParse(parsed);
if (!result.success) {
  logEvent('warn', 'PRESET_OVERRIDE_INVALID', { errors: result.error.issues });
  return { add: [], remove: [], skip: [] };   // fallback to empty, UI 显黄条
}
```

不让坏配置阻挂 daemon。

## Schema 定义集中

`daemon/src/config/schemas.ts`：

```ts
import { z } from 'zod';

export const CheckCommandsSchema = z.object({
  build: z.string().default(''),
  test: z.string().default(''),
  typecheck: z.string().default(''),
});

export const PresetOverridesSchema = z.object({
  add: z.array(z.object({
    slug: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
    category: z.enum([...] /* GapCategory list */),
    description: z.string().min(1),
    severity: z.enum(['P1','P2','P3']),
  })).default([]),
  remove: z.array(z.string()).default([]),
  skip: z.array(z.string()).default([]),
});

export const PresetFrontmatterSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().positive(),
  inherits: z.array(z.string()).optional(),
  high_sensitivity_categories: z.array(z.string()).optional(),
});

export const ConfigJsonSchema = z.object({
  daemonPort: z.number().int().min(1024).max(65535).default(5174),
  uiPort: z.number().int().min(1024).max(65535).default(5173),
  uiOrigin: z.string().default('http://localhost:5173'),
  claudeBin: z.string().default('claude'),
  gitBin: z.string().default('git'),
  logRetentionDays: z.number().int().positive().default(90),
  models: z.object({
    haiku: z.string(),
    sonnet: z.string(),
    opus: z.string(),
  }).optional(),
});
```

## 安全注意

- demo path 永不写入 prompt 文本（只走 `cwd`）—— 防 path injection
- `.zerou/*` 仅 daemon 写；用户手编也行但 daemon 启动时校验；schema fail 视作空
- 不读 home 目录之外的 secret 文件
- `ANTHROPIC_API_KEY` env var 即使存在也不传给 daemon（daemon 不用），传给 spawn 的 `claude` 进程由 cc 自己决定
