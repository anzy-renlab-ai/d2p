---
id: llm-cost-uncapped
version: 2
name: LLM cost uncapped (vibe-coded apps)
appliesTo: []
rules:
  - ruleId: llm-call-without-max-tokens
    label: LLM chat completion call without max_tokens / max_output_tokens cap
    severity: P1
    mechanism: llm-judgment
    source: llm-cost-uncapped/v2
    rationale: "A `chat.completions.create` / `messages.create` call without `max_tokens` (OpenAI) or `max_output_tokens` (Anthropic) can return up to the model context window. A single prompt-injected response can bill thousands of dollars. Always set an explicit cap."
    detection:
      pattern: "(openai|anthropic|client)\\.(chat\\.completions|messages|responses)\\.create\\s*\\("
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation required: add max_tokens (OpenAI) or max_output_tokens (Anthropic). Pick a budget that matches the use case, e.g. 1024 for chat, 256 for classification.'"
      verifyCommand: "! grep -rEn '(openai|anthropic|client)\\.(chat\\.completions|messages|responses)\\.create' src/ | grep -v 'max_tokens\\|max_output_tokens'"
  - ruleId: user-input-untruncated-to-llm
    label: User input forwarded to LLM prompt without length truncation
    severity: P1
    mechanism: llm-judgment
    source: llm-cost-uncapped/v2
    rationale: "A pattern like prompt = req.body.text lets a user paste 200 KB and bill the full prompt-token cost per request. Truncate user-controlled strings with `.slice(0, N)` (or a token-aware truncator) before they enter the prompt. Also defends against prompt-injection by capping payload size."
    detection:
      pattern: "(prompt|messages|input|content)\\s*[:=]\\s*req\\.(body|query|params)\\."
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation required: wrap user input in .slice(0, MAX_USER_INPUT_CHARS) (e.g. 4000) before passing to LLM; or use a token-aware truncator like @dqbd/tiktoken'"
      verifyCommand: "grep -rEn '\\.slice\\s*\\(\\s*0\\s*,' src/ | grep -E '(prompt|messages|input|content)' || true"
  - ruleId: llm-no-per-user-rate-limit
    label: No per-user rate limit guarding LLM endpoint
    severity: P2
    mechanism: llm-judgment
    source: llm-cost-uncapped/v2
    rationale: "Global rate limits are not enough — one user opening 60 tabs still drains your account. Apply per-user (or per-api-key) limits using `@upstash/ratelimit`, `express-rate-limit` with `keyGenerator`, or a Redis-backed token bucket. The static grep finds endpoints that touch LLM SDKs; LLM judgment verifies they are guarded by a per-user limiter."
    detection:
      pattern: "(app|router)\\.(post|get|put|patch)\\s*\\([^)]*\\)\\s*[^{]*\\{[\\s\\S]{0,500}?(openai|anthropic|client)\\.(chat\\.completions|messages|responses)\\.create"
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation required: add per-user rate limit middleware (express-rate-limit with keyGenerator=req.user.id, or @upstash/ratelimit) before the LLM-calling handler'"
      verifyCommand: "grep -rEn 'rateLimit|ratelimit|Ratelimit|keyGenerator' src/"
  - ruleId: openai-no-max-tokens
    label: openai.chat.completions.create called without max_tokens
    severity: P2
    mechanism: static-grep
    source: llm-cost-uncapped/v2
    rationale: "OpenAI defaults `max_tokens` to the full model context window (up to 128k). A prompt-injected response can fill the entire window — billed at completion-token rates. Always set an explicit `max_tokens` matched to the use case (256 for classification, 1024 for chat, 4096 for long-form)."
    detection:
      pattern: openai\.chat\.completions\.create\s*\(\s*\{(?:(?!max_tokens|max_completion_tokens).)*\}
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: add max_tokens: 1024 (chat) or 256 (classification) to every openai.chat.completions.create call'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: openai-loop-no-cost-cap
    label: openai.create call inside a loop with no dollar-cost cap
    severity: P1
    mechanism: llm-judgment
    source: llm-cost-uncapped/v2
    rationale: "A `for (const item of items) await openai.create(...)` with no `if (totalCostUSD > MAX) break` check and no upper bound on `items.length` can bill arbitrary amounts. Cap by item count, by cumulative input+output tokens estimated cost, or by wall-clock budget — whichever fires first."
    detection:
      pattern: for\s*\([^)]*\)\s*\{[\s\S]{0,500}?(openai|anthropic|client)\.(chat\.completions|messages|responses)\.create
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: track totalTokens (from response.usage); break the loop when estimated cost (totalTokens * pricePerToken) exceeds MAX_DOLLARS'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: anthropic-no-max-tokens
    label: anthropic.messages.create called without max_tokens
    severity: P2
    mechanism: static-grep
    source: llm-cost-uncapped/v2
    rationale: "Anthropic requires `max_tokens` and will reject without it — but a vibe-coded path that catches and retries can still leak. Worse, a developer copy-pasting from OpenAI examples may pick an oversized value (8192 default seen in tutorials). Set a tight value matched to the use case."
    detection:
      pattern: anthropic\.messages\.create\s*\(\s*\{(?:(?!max_tokens).)*\}
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: anthropic.messages.create({ ..., max_tokens: 1024 }); never omit it; tighten for short-form'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: stream-with-no-abort
    label: openai stream:true used without AbortController wired
    severity: P2
    mechanism: static-grep
    source: llm-cost-uncapped/v2
    rationale: "Streaming completions are billed by tokens produced, not by tokens consumed by the client. If the user closes their tab the server keeps the connection open and pays for the full response. Wire an AbortController, attach to req.on('close', () => controller.abort()), and pass {signal} to the SDK call."
    detection:
      pattern: \.(create|stream)\s*\(\s*\{[\s\S]{0,300}stream\s*:\s*true
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: const controller = new AbortController(); req.on(\"close\", () => controller.abort()); openai.chat.completions.create({ ..., stream: true }, { signal: controller.signal })'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: no-rate-limit-on-llm-endpoint
    label: Express / Fastify handler that calls an LLM with no rate-limit middleware in the chain
    severity: P2
    mechanism: llm-judgment
    source: llm-cost-uncapped/v2
    rationale: "Any unauthenticated or weakly-rate-limited endpoint that calls an LLM is a money pump. Apply rate-limit middleware (express-rate-limit / @upstash/ratelimit / hono-rate-limiter) at minimum globally, ideally per-user. LLM judgment verifies the handler in question is gated."
    detection:
      pattern: \.(post|get|put|patch)\s*\([^)]+,\s*[\s\S]{0,800}?(openai|anthropic)\.(chat\.completions|messages|responses)\.create
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: install express-rate-limit and apply globally before /api/* (or per-handler with keyGenerator=req.user.id)'"
      verifyCommand: "grep -rE 'rateLimit|@upstash/ratelimit|hono-rate-limiter' src/"
  - ruleId: prompt-from-user-no-validation
    label: req.body field passed directly into prompt without validation
    severity: P2
    mechanism: static-grep
    source: llm-cost-uncapped/v2
    rationale: "`prompt: req.body.input` (or `messages: [{ role: 'user', content: req.body.text }]`) without validation is the prompt-injection ground. The user controls the input — they can paste 100KB to inflate prompt-token cost, embed jailbreaks, or smuggle malicious tool-use instructions. Validate with zod / valibot, truncate length, and consider an allow-list."
    detection:
      pattern: (prompt|content|input|messages)\s*:\s*req\.(body|query|params)\.[a-zA-Z_$][a-zA-Z0-9_$]*\b
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: const Body = z.object({input: z.string().min(1).max(4000)}); const {input} = Body.parse(req.body); — validate length and shape, do not pipe raw req.body'"
      verifyCommand: "! grep -rE '(prompt|content|input|messages)\\s*:\\s*req\\.(body|query|params)\\.[a-zA-Z_$]' src/"
  - ruleId: expensive-model-default
    label: Expensive model literal used as default (gpt-4-32k / claude-opus / o1)
    severity: P3
    mechanism: static-grep
    source: llm-cost-uncapped/v2
    rationale: "Hardcoding `model: 'gpt-4-32k'` / `'claude-opus-4'` / `'o1-preview'` as the default makes every request hit the most expensive tier. For classification, drafting, and short Q&A, a smaller model (gpt-4o-mini, claude-haiku, gpt-3.5) is 10-50× cheaper and often sufficient. Choose the model per use case; only escalate when quality demands it."
    detection:
      pattern: model\s*:\s*['"`](gpt-4-32k|gpt-4-turbo|claude-opus|claude-3-opus|claude-3-5-opus|o1-preview|o1-pro)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: default to gpt-4o-mini / claude-haiku / claude-3-5-sonnet; route to the expensive model only when complexity warrants it'"
      verifyCommand: "echo 'manual review required'"
---

# LLM cost uncapped

The "$10,000 weekend bill" failure mode: a vibe-coded LLM endpoint shipped
with no token cap, no input truncation, no per-user rate limit, no
streaming abort, and an expensive model as the default. The rules below
catch the canonical cost amplifiers.

## Rules

1. **`llm-call-without-max-tokens`** — every `chat.completions.create` /
   `messages.create` call must set `max_tokens` (OpenAI) or
   `max_output_tokens` (Anthropic). Without a cap one response can fill
   the entire context window.
2. **`user-input-untruncated-to-llm`** — user-controlled strings flowing
   into a prompt must be truncated (`.slice(0, N)` or a token-aware
   truncator). Prevents a 200 KB paste from billing prompt-token cost on
   every request.
3. **`llm-no-per-user-rate-limit`** — endpoints that invoke an LLM SDK
   must be guarded by a per-user (not just global) rate limiter; otherwise
   a single user with multiple sessions can drain your account.

## Remediation

```ts
// max_tokens cap
const completion = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  max_tokens: 1024,                        // hard cap
  messages: [{ role: 'user', content: prompt }],
});
```

```ts
// truncate user input
const MAX_USER_CHARS = 4_000;
const safeInput = String(req.body.text ?? '').slice(0, MAX_USER_CHARS);
const completion = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  max_tokens: 1024,
  messages: [{ role: 'user', content: safeInput }],
});
```

```ts
// per-user rate limit (Express)
import rateLimit from 'express-rate-limit';
const llmLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyGenerator: (req) => req.user?.id ?? req.ip,
});
app.post('/api/chat', requireAuth, llmLimiter, async (req, res) => { /* ... */ });
```

Re-run `zerou audit` after fixes; the verify commands must exit 0.
