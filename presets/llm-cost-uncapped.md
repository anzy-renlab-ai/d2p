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
---

# LLM cost uncapped

The "$10,000 weekend bill" failure mode: a vibe-coded LLM endpoint shipped
with no token cap, no input truncation, and no per-user rate limit. Three
rules catch the canonical cost amplifiers.

## Three rules

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
