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
import type { TrackLogger } from './log-types.js';
import { logBranch, logCatch } from './log/branch.js';
import { fetchLlm } from './agent/llm-fetch.js';

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
  /** Optional logger for decision-branch tracing. */
  logger?: TrackLogger | null;
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
  const log = params.logger;
  const url = params.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const timeoutMs = params.timeoutMs ?? 30_000;

  const fetched = await fetchLlm({
    url,
    apiKey: params.apiKey,
    model: params.modelId,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(params.finding),
    timeoutMs,
    logger: log ?? undefined,
    branchPrefix: 'critic.llm-fetch',
  });

  if (!fetched.ok) {
    // Map error to P1-E-2 (network/transport) vs P1-E-3 (envelope parse).
    const isEnvelope = /envelope/i.test(fetched.error) || /missing/i.test(fetched.error);
    const errorCode: 'P1-E-2' | 'P1-E-3' = isEnvelope ? 'P1-E-3' : 'P1-E-2';
    logBranch(log, 'critic.http.status-decision', {
      decision: isEnvelope ? 'envelope-parse-failed' : 'http-or-network-error',
      status: fetched.statusCode ?? null,
      attempts: fetched.attempts,
      errorCode,
    });
    return {
      ok: false,
      errorCode,
      error: fetched.error,
      rawResponseText: '',
      durationMs: fetched.durationMs,
    };
  }
  const content = fetched.rawText;
  const durationMs = fetched.durationMs;
  const rawText = content;
  logBranch(log, 'critic.http.status-decision', {
    decision: 'http-ok',
    status: 200,
    attempts: fetched.attempts,
  });
  logBranch(log, 'critic.parse.envelope-decision', {
    decision: 'envelope-parsed',
    contentLen: content.length,
  });

  // Parse the model's inner JSON. Robust to reasoning models that prepend
  // <think>...</think> blocks (MiniMax-M2.7, DeepSeek-R1, etc.) and to
  // models that wrap JSON in markdown fences.
  let modelOut: unknown;
  try {
    let cleaned = content;
    // Strip <think>...</think> blocks (greedy across newlines)
    const hadThink = /<think>[\s\S]*?<\/think>/.test(cleaned);
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (hadThink) {
      logBranch(log, 'critic.parse.think-block-decision', {
        decision: 'stripped',
        reasoning: 'reasoning-model emitted <think>…</think>',
      });
    }
    // Strip markdown code fences
    const hadFence = /^```/.test(cleaned);
    cleaned = cleaned.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    if (hadFence) {
      logBranch(log, 'critic.parse.markdown-fence-decision', {
        decision: 'stripped',
        reasoning: 'model wrapped JSON in markdown fence',
      });
    }
    // If still not JSON-shaped, find the outermost {...} block
    if (!cleaned.startsWith('{')) {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) {
        cleaned = m[0];
        logBranch(log, 'critic.parse.outer-json-decision', {
          decision: 'extracted',
          reasoning: 'content not bare JSON; extracted outermost {…}',
        });
      } else {
        logBranch(log, 'critic.parse.outer-json-decision', {
          decision: 'not-found',
          reasoning: 'no {…} block discovered; parse will fail',
        });
      }
    }
    modelOut = JSON.parse(cleaned);
  } catch (e) {
    logCatch(log, 'critic.parse.inner-json-decision', e, {
      contentPreview: content.slice(0, 80),
      errorCode: 'P1-E-3',
    });
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
    logBranch(log, 'critic.parse.verdict-validation-decision', {
      decision: 'reject',
      reasoning: 'verdict not in enum',
      gotVerdict: String(verdict),
      errorCode: 'P1-E-3',
    });
    return {
      ok: false,
      errorCode: 'P1-E-3',
      error: `verdict not in enum: ${String(verdict)}`,
      rawResponseText: rawText,
      durationMs,
    };
  }
  logBranch(log, 'critic.parse.verdict-validation-decision', {
    decision: 'accept',
    verdict,
  });
  const reasoning = typeof rec.reasoning === 'string' ? rec.reasoning.slice(0, 500) : '';
  let requiredContext: string[] = [];
  if (verdict === 'needs-context') {
    requiredContext = Array.isArray(rec.requiredContext)
      ? rec.requiredContext.filter((x): x is string => typeof x === 'string')
      : [];
    // Empty requiredContext for needs-context → coerce to false-positive per P1-E-4
    if (requiredContext.length === 0) {
      logBranch(
        log,
        'critic.parse.coerce-decision',
        {
          decision: 'coerce-to-false-positive',
          reasoning: 'needs-context but requiredContext is empty (P1-E-4)',
        },
        { level: 'info' },
      );
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
    logBranch(log, 'critic.parse.coerce-decision', {
      decision: 'keep-needs-context',
      requiredContextCount: requiredContext.length,
    });
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
