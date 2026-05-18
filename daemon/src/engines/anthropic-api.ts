// Anthropic Messages API engine. Raw fetch — no SDK to keep deps thin.

import type { ClaudeCallResult, ClaudeModel } from '../types.js';
import type { LLMEngine, EngineCallOpts } from './types.js';
import type { AnthropicApiEngineConfig } from '../config/types.js';

const DEFAULT_BASE = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';

interface MessagesResponse {
  content?: { type?: string; text?: string }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  error?: { message?: string };
}

const SYSTEM_PROMPT =
  'You output JSON only — no markdown fence, no preamble, no commentary. If the input asks for a specific JSON schema, output exactly that schema.';

function stripThinking(s: string): string {
  return s
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
}

function extractLastBalancedJson(s: string): string | null {
  for (let end = s.length - 1; end >= 0; end--) {
    const ch = s[end];
    if (ch !== '}' && ch !== ']') continue;
    let depth = 0;
    let inStr = false;
    let escaped = false;
    for (let i = end; i >= 0; i--) {
      const c = s[i];
      if (inStr) {
        if (escaped) { escaped = false; continue; }
        if (c === '\\') { escaped = true; continue; }
        if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === '}' || c === ']') depth++;
      else if (c === '{' || c === '[') {
        depth--;
        if (depth === 0) return s.slice(i, end + 1);
      }
    }
  }
  return null;
}

function tryParseJsonLoose(s: string): unknown {
  const cleaned = stripThinking(s).trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned);
  if (fenced && fenced[1]) {
    try { return JSON.parse(fenced[1]); } catch { /* fall through */ }
  }
  const balanced = extractLastBalancedJson(cleaned);
  if (balanced) {
    try { return JSON.parse(balanced); } catch { /* fall through */ }
  }
  throw new Error('no parseable JSON in response');
}

export class AnthropicApiEngine implements LLMEngine {
  readonly id: string;

  constructor(private readonly cfg: AnthropicApiEngineConfig) {
    this.id = `anthropic-api:${new URL(cfg.baseUrl ?? DEFAULT_BASE).host}`;
  }

  private modelFor(m: ClaudeModel): string {
    return this.cfg.models[m];
  }

  async call<T = unknown>(opts: EngineCallOpts<T>): Promise<ClaudeCallResult<T>> {
    const base = (this.cfg.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    const url = `${base}/v1/messages`;
    const body = {
      model: this.modelFor(opts.model),
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: opts.prompt }],
      temperature: 0,
    };
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-api-key': this.cfg.apiKey,
      'anthropic-version': API_VERSION,
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
    let parsed: MessagesResponse;
    try {
      parsed = JSON.parse(raw) as MessagesResponse;
    } catch (e) {
      return { ok: false, code: 'NON_JSON', message: (e as Error).message, raw };
    }
    if (parsed.error?.message) {
      return { ok: false, code: 'NON_ZERO_EXIT', message: parsed.error.message, raw };
    }
    const textBlocks = (parsed.content ?? []).filter((b) => b.type === 'text');
    const text = textBlocks.map((b) => b.text ?? '').join('\n');
    let json: unknown;
    try {
      json = tryParseJsonLoose(text);
    } catch (e) {
      return { ok: false, code: 'NON_JSON', message: (e as Error).message, raw: text };
    }
    if (opts.schemaCheck && !opts.schemaCheck(json)) {
      return { ok: false, code: 'SCHEMA', message: 'schema check failed', raw: text };
    }
    return {
      ok: true,
      json: json as T,
      raw,
      usage: {
        inputTokens: parsed.usage?.input_tokens ?? 0,
        outputTokens: parsed.usage?.output_tokens ?? 0,
        cacheReadTokens: parsed.usage?.cache_read_input_tokens ?? 0,
        cacheWriteTokens: parsed.usage?.cache_creation_input_tokens ?? 0,
      },
    };
  }

  async probe(): Promise<{ ok: boolean; detail?: string }> {
    // Anthropic has no `/health` — minimal real call to check key.
    try {
      const res = await fetch((this.cfg.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '') + '/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.cfg.apiKey,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify({
          model: this.modelFor('haiku'),
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok || res.status === 400) {
        // 400 still means auth was accepted — bad request body is fine.
        return { ok: true, detail: `${new URL(this.cfg.baseUrl ?? DEFAULT_BASE).host}` };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, detail: `auth failed (HTTP ${res.status})` };
      }
      return { ok: false, detail: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
