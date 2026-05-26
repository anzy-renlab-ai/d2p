# MiniMax 用于 ZeroU 跨家族 critic

ZeroU 把 MiniMax 当 `openai-compat` 引擎接入。MiniMax 服务器收 OpenAI Chat Completions 协议，用 Bearer Authorization。

## 1. 拿 MiniMax key

- 国际版：<https://www.minimaxi.com/> 注册后控制台拿 API key
- 国内版：<https://platform.minimaxi.com/>

## 2. 配置文件

把下面这份保存到 `~/.zerou/config.json` 或自定义路径，跑 audit 时用 `--config` 指向它：

```json
{
  "worker": {
    "kind": "claude-cli",
    "modelId": "claude-haiku-4-5-20251001",
    "releaseDate": "2025-10-01"
  },
  "criticPool": [
    {
      "kind": "openai-compat",
      "modelId": "MiniMax-Text-01",
      "releaseDate": "2025-01-15",
      "baseUrl": "https://api.minimaxi.chat/v1"
    }
  ],
  "failOn": "none"
}
```

**Unix 必 `chmod 600`**，否则 ZeroU 报 unsafe-perms 退 3。Windows 跳过权限检查。

可用 model 名（按 MiniMax 当前命名）：
- `MiniMax-Text-01`
- `abab6.5s-chat`
- `abab6.5-chat-pro`
- 看 MiniMax 控制台最新支持的

国内版 baseUrl 换成 `https://api.minimax.chat/v1`。

## 3. 提供 key（三层精度）

按优先级（高→低）：

| 方式 | 例子 |
|---|---|
| CLI flag（最高）| `zerou audit ... --key openai-compat=<your-minimax-key>` |
| 环境变量 | `export ZEROU_OPENAI_COMPAT_KEY=<your-key>` |
| 配置文件 | `config.json` 加 `"keys": {"openai-compat": "<your-key>"}` |

flag 方式跑完会自动从 `process.argv` redact，避免 `ps` 历史里泄露。

## 4. 跑 audit

```bash
export ZEROU_OPENAI_COMPAT_KEY=<your-minimax-key>
node /d/lll/d2p/cli/bin/zerou.mjs audit /path/to/your-app \
  --config ~/.zerou/config.json \
  --out /tmp/audit-bundle.json
```

每条 finding 都会真打 MiniMax 一次，verdict 会从 `critic-unavailable` 升级到 `confirmed` / `false-positive` / `needs-context`。

## 5. 怎么看真跑了

跑完用 `zerou trace`：

```bash
node /d/lll/d2p/cli/bin/zerou.mjs trace --last --path /path/to/your-app
```

应该看到一连串：
- `critic.policy-selected { criticFamily: "api.minimaxi.chat", criticHasKey: true }`
- `critic.review.start { findingId: ..., crossFamily: true }`
- `critic.review.success { findingId: ..., verdict: "confirmed", durationMs: ~2000 }` ← MiniMax 真回了
- 或 `critic.invocation-failure { errorCode: "P1-E-2", error: "HTTP 401 ..." }` ← key 不对

## 6. 故障排查

| 错 | 原因 | 修法 |
|---|---|---|
| `HTTP 401: login fail` | Key 无效或过期 | 在控制台重新生成 |
| `HTTP 429` | rate limit | 控制台升档或等等 |
| `inner JSON parse failed` | MiniMax 没返 strict JSON（少见）| 换 modelId（不同 model JSON 严格度不一样）|
| 全部 `critic-unavailable` 但 critic log 是空的 | key 没被检测到 | 检查 `ZEROU_OPENAI_COMPAT_KEY` 是不是导出了，重跑 |

## 7. 验证 wiring 的占位测试

用占位 key 跑一次会被 MiniMax 401 拒，但能证明 HTTP 通路通：

```bash
ZEROU_OPENAI_COMPAT_KEY="placeholder-for-wiring-test" \
  node /d/lll/d2p/cli/bin/zerou.mjs audit ./some-fixture \
  --config /path/to/minimax-config.json
```

期望：每个 finding 一条 `critic.invocation-failure` log，错误是 `HTTP 401: login fail`。证明请求到了 MiniMax 服务器。

---

**Status**: MiniMax wiring 2026-05-26 已在 `cli/src/critic-client.ts` + `cli/src/stubs.ts` 落地。同适用于任何 OpenAI Chat Completions 协议的 provider（DeepSeek、Moonshot、Z.ai 智谱 GLM、OpenRouter、本地 vLLM/llama.cpp/LM Studio）—— 只换 baseUrl 即可。
