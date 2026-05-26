/**
 * Lightweight OpenAI-Chat-Completions client for cross-engine critic calls.
 *
 * Used by `defaultRunPreset` in stubs.ts when a `criticPolicy.crossFamily`
 * + `criticConfig` + matching API key are available.
 *
 * Supports any provider that speaks OpenAI's `/chat/completions` shape:
 * - MiniMax (api.minimaxi.chat / api.minimax.chat)
 * - DeepSeek (api.deepseek.com)
 * - Moonshot/Kimi
 * - OpenRouter
 * - Z.ai (智谱 GLM)
 * - Local: vLLM / llama.cpp / LM Studio
 *
 * Returns a Verdict for one finding, or null if the call/parse failed.
 */

export type CriticVerdict = 'confirmed' | 'false-positive' | 'needs-context';

export interface CriticCallParams {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  finding: {
    file: string;
    line: number;
    evidence: string;
    message: string;
    ruleId: string;
  };
  timeoutMs?: number;
}

export interface CriticCallResult {
  ok: true;
  verdict: CriticVerdict;
  reasoning: string;
  requiredContext: string[];
  rawResponseText: string;
  costUsd: number | null;
  durationMs: number;
}

export interface CriticCallFailure {
  ok: false;
  errorCode: 'P1-E-2' | 'P1-E-3';
  error: string;
  rawResponseText: string;
  durationMs: number;
}

const SYSTEM_PROMPT =
  'You are a security reviewer. Output JSON only — no markdown fence, no preamble. Schema: {"verdict": "confirmed"|"false-positive"|"needs-context", "reasoning": "≤500 chars", "requiredContext": ["..."] (only when verdict is needs-context)}.';

function buildUserPrompt(p: CriticCallParams['finding']): string {
  return [
    `A static scanner flagged a possible secret leak in source code.`,
    ``,
    `File: ${p.file}:${p.line}`,
    `Rule: ${p.ruleId}`,
    `Reported issue: ${p.message}`,
    `Evidence (the matched substring): ${JSON.stringify(p.evidence)}`,
    ``,
    `Decide if this is a REAL secret being leaked, or a false positive (e.g. test fixture, example value, placeholder, public identifier mistaken for a secret).`,
    ``,
    `Reply with strict JSON: {"verdict": "confirmed"|"false-positive"|"needs-context", "reasoning": "...", "requiredContext"?: [...]}`,
  ].join('\n');
}

/**
 * Calls an OpenAI-Chat-Completions-compatible critic. Best-effort; failures
 * are reported as `{ok: false}` with the appropriate Protocol-1 error code so
 * the caller can mark the finding `critic-unavailable`.
 */
export async function callOpenAICompatCritic(
  params: CriticCallParams,
): Promise<CriticCallResult | CriticCallFailure> {
  const start = Date.now();
  const url = params.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const body = {
    model: params.modelId,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(params.finding) },
    ],
    temperature: 0,
    stream: false,
  };
  const timeoutMs = params.timeoutMs ?? 30_000;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return {
      ok: false,
      errorCode: 'P1-E-2',
      error: (e as Error).message ?? String(e),
      rawResponseText: '',
      durationMs: Date.now() - start,
    };
  }

  const rawText = await res.text();
  const durationMs = Date.now() - start;

  if (!res.ok) {
    return {
      ok: false,
      errorCode: 'P1-E-2',
      error: `HTTP ${res.status}: ${rawText.slice(0, 200)}`,
      rawResponseText: rawText,
      durationMs,
    };
  }

  // Parse the response envelope (OpenAI chat shape)
  let envelope: unknown;
  try {
    envelope = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      errorCode: 'P1-E-3',
      error: 'response envelope not valid JSON',
      rawResponseText: rawText,
      durationMs,
    };
  }
  const content = (envelope as { choices?: Array<{ message?: { content?: string } }> })
    .choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    return {
      ok: false,
      errorCode: 'P1-E-3',
      error: 'response missing choices[0].message.content',
      rawResponseText: rawText,
      durationMs,
    };
  }

  // Parse the model's inner JSON. Robust to reasoning models that prepend
  // <think>...</think> blocks (MiniMax-M2.7, DeepSeek-R1, etc.) and to
  // models that wrap JSON in markdown fences.
  let modelOut: unknown;
  try {
    let cleaned = content;
    // Strip <think>...</think> blocks (greedy across newlines)
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    // Strip markdown code fences
    cleaned = cleaned.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    // If still not JSON-shaped, find the outermost {...} block
    if (!cleaned.startsWith('{')) {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) cleaned = m[0];
    }
    modelOut = JSON.parse(cleaned);
  } catch {
    return {
      ok: false,
      errorCode: 'P1-E-3',
      error: `inner JSON parse failed; content: ${content.slice(0, 200)}`,
      rawResponseText: rawText,
      durationMs,
    };
  }
  const rec = modelOut as { verdict?: unknown; reasoning?: unknown; requiredContext?: unknown };
  const verdict = rec.verdict;
  if (
    verdict !== 'confirmed' &&
    verdict !== 'false-positive' &&
    verdict !== 'needs-context'
  ) {
    return {
      ok: false,
      errorCode: 'P1-E-3',
      error: `verdict not in enum: ${String(verdict)}`,
      rawResponseText: rawText,
      durationMs,
    };
  }
  const reasoning = typeof rec.reasoning === 'string' ? rec.reasoning.slice(0, 500) : '';
  let requiredContext: string[] = [];
  if (verdict === 'needs-context') {
    requiredContext = Array.isArray(rec.requiredContext)
      ? rec.requiredContext.filter((x): x is string => typeof x === 'string')
      : [];
    // Empty requiredContext for needs-context → coerce to false-positive per P1-E-4
    if (requiredContext.length === 0) {
      return {
        ok: true,
        verdict: 'false-positive',
        reasoning: reasoning + ' (coerced from needs-context with empty context)',
        requiredContext: [],
        rawResponseText: rawText,
        costUsd: null,
        durationMs,
      };
    }
  }

  return {
    ok: true,
    verdict,
    reasoning,
    requiredContext,
    rawResponseText: rawText,
    costUsd: null, // cost reporting not standardized across openai-compat providers
    durationMs,
  };
}
