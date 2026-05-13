// OpenAI Chat Completions wire-format engine. Covers OpenAI, OpenRouter,
// DeepSeek, Z.ai (智谱 GLM), Moonshot (Kimi), Qwen, vLLM, llama.cpp server,
// LM Studio, etc. — all use the same `/chat/completions` shape.

import type { ClaudeCallResult, ClaudeModel } from '../types.js';
import type { LLMEngine, EngineCallOpts } from './types.js';
import type { OpenAICompatEngineConfig } from '../config/types.js';

interface ChatChoice {
  message?: { content?: string };
}

interface ChatResponse {
  choices?: ChatChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

const SYSTEM_PROMPT =
  'You output JSON only — no markdown fence, no preamble, no commentary. If the input asks for a specific JSON schema, output exactly that schema.';

function tryParseJsonLoose(s: string): unknown {
  // Try direct first
  try {
    return JSON.parse(s);
  } catch {
    // ignore
  }
  // Some providers wrap output in ```json ... ``` despite system prompt.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // ignore
    }
  }
  // Greedy {...} extraction (last resort).
  const braceStart = s.indexOf('{');
  const braceEnd = s.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    try {
      return JSON.parse(s.slice(braceStart, braceEnd + 1));
    } catch {
      // ignore
    }
  }
  throw new Error('no parseable JSON in response');
}

export class OpenAICompatEngine implements LLMEngine {
  readonly id: string;

  constructor(private readonly cfg: OpenAICompatEngineConfig) {
    this.id = `openai-compat:${new URL(cfg.baseUrl).host}`;
  }

  private modelFor(m: ClaudeModel): string {
    return this.cfg.models[m];
  }

  async call<T = unknown>(opts: EngineCallOpts<T>): Promise<ClaudeCallResult<T>> {
    const url = this.cfg.baseUrl.replace(/\/$/, '') + '/chat/completions';
    const body = {
      model: this.modelFor(opts.model),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: opts.prompt },
      ],
      temperature: 0,
      stream: false,
    };
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.cfg.apiKey}`,
      ...(this.cfg.extraHeaders ?? {}),
    };

    const timeoutMs = opts.timeoutMs ?? 180_000;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const err = e as Error;
      if (err.name === 'TimeoutError' || /aborted|timeout/i.test(err.message)) {
        return { ok: false, code: 'TIMEOUT', message: err.message, raw: '' };
      }
      return { ok: false, code: 'NON_ZERO_EXIT', message: err.message, raw: '' };
    }

    const raw = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        code: 'NON_ZERO_EXIT',
        message: `HTTP ${res.status}: ${raw.slice(0, 500)}`,
        raw,
      };
    }
    let parsed: ChatResponse;
    try {
      parsed = JSON.parse(raw) as ChatResponse;
    } catch (e) {
      return { ok: false, code: 'NON_JSON', message: (e as Error).message, raw };
    }
    if (parsed.error?.message) {
      return { ok: false, code: 'NON_ZERO_EXIT', message: parsed.error.message, raw };
    }
    const content = parsed.choices?.[0]?.message?.content ?? '';
    let json: unknown;
    try {
      json = tryParseJsonLoose(content);
    } catch (e) {
      return { ok: false, code: 'NON_JSON', message: (e as Error).message, raw: content };
    }
    if (opts.schemaCheck && !opts.schemaCheck(json)) {
      return { ok: false, code: 'SCHEMA', message: 'schema check failed', raw: content };
    }
    return {
      ok: true,
      json: json as T,
      raw,
      usage: {
        inputTokens: parsed.usage?.prompt_tokens ?? 0,
        outputTokens: parsed.usage?.completion_tokens ?? 0,
      },
    };
  }

  async probe(): Promise<{ ok: boolean; detail?: string }> {
    // GET models is the most universally supported probe.
    try {
      const url = this.cfg.baseUrl.replace(/\/$/, '') + '/models';
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${this.cfg.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return { ok: true, detail: `${new URL(this.cfg.baseUrl).host}` };
      return { ok: false, detail: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
