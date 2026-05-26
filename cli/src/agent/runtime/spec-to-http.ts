/**
 * Converts a TestCaseSpec (Phase 5) into an HttpTestSpec where possible
 * (Phase 6 §spec-to-http).
 *
 * Strategy (v1):
 *   1. If spec.scope.type === 'endpoint' and target matches `METHOD /path`,
 *      build the HttpTestSpec heuristically. Status / body shape are
 *      extracted from `then` via best-effort regex (e.g. "returns 400").
 *   2. If a critic LLM is available, ask it to convert. The LLM returns
 *      `{ method, path, body?, expectedStatus?, expectedBodyShape? }` or
 *      `null` if the spec is not HTTP-testable.
 *   3. Otherwise return null.
 *
 * Emits:
 *   - agent.runtime.spec-to-http.heuristic-decision { decision, reason }
 *   - agent.runtime.spec-to-http.llm-call.{start,success,failure}
 *   - agent.runtime.spec-to-http.complete { specId, kind: heuristic|llm|none }
 */
import type { TrackLogger } from '../../log-types.js';
import { logBranch, logCatch } from '../../log/branch.js';
import type { EngineConfig } from '../../stubs.js';
import type { TestCaseSpec } from '../types.js';
import type { HttpTestSpec } from './types.js';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

export interface SpecToHttpOptions {
  logger?: TrackLogger | null;
  criticConfig?: EngineConfig | null;
  criticApiKey?: string | null;
  /** Test injection — replace the LLM call. */
  callLLM?: SpecLlmCaller;
  /** Per-call timeout (default 15s). */
  timeoutMs?: number;
}

export type SpecLlmCaller = (args: {
  systemPrompt: string;
  userPrompt: string;
  criticConfig: EngineConfig;
  apiKey: string;
  timeoutMs: number;
}) => Promise<{ rawText: string; durationMs: number }>;

const DEFAULT_TIMEOUT_MS = 15_000;

export async function specToHttpTest(
  spec: TestCaseSpec,
  opts: SpecToHttpOptions,
): Promise<HttpTestSpec | null> {
  const logger = opts.logger;

  // 1. Heuristic — only when scope.type === 'endpoint'
  if (spec.scope.type === 'endpoint') {
    const heur = heuristicFromEndpointTarget(spec);
    if (heur) {
      logBranch(
        logger,
        'agent.runtime.spec-to-http.heuristic-decision',
        {
          decision: 'matched',
          reasoning: 'endpoint scope with METHOD /path target',
          specId: spec.id,
          method: heur.method,
          path: heur.path,
        },
        { level: 'info' },
      );
      if (logger) {
        logger.log('info', 'agent.runtime.spec-to-http.complete', {
          specId: spec.id,
          kind: 'heuristic',
        });
      }
      return heur;
    }
    logBranch(logger, 'agent.runtime.spec-to-http.heuristic-decision', {
      decision: 'no-match',
      reasoning: 'endpoint scope but target not METHOD /path',
      specId: spec.id,
      target: spec.scope.target,
    });
  }

  // 2. LLM fallback (if available)
  if (opts.criticConfig && opts.criticApiKey) {
    const result = await tryLlmConversion(spec, opts);
    if (result) {
      if (logger) {
        logger.log('info', 'agent.runtime.spec-to-http.complete', {
          specId: spec.id,
          kind: 'llm',
        });
      }
      return result;
    }
  }

  // 3. Give up
  if (logger) {
    logger.log('info', 'agent.runtime.spec-to-http.complete', {
      specId: spec.id,
      kind: 'none',
    });
  }
  return null;
}

// ── Heuristic ───────────────────────────────────────────────────────────────

/**
 * Parse `target` of the form `METHOD /path` (e.g. `POST /api/login`). Also
 * accepts `/path` (defaulting to GET). Returns null if target doesn't fit.
 */
function heuristicFromEndpointTarget(spec: TestCaseSpec): HttpTestSpec | null {
  const t = spec.scope.target.trim();
  let method: HttpMethod = 'GET';
  let pathStr: string | null = null;

  const m = /^([A-Z]+)\s+(\/[^\s]*)$/.exec(t);
  if (m) {
    const candidate = m[1] as string;
    if ((HTTP_METHODS as readonly string[]).includes(candidate)) {
      method = candidate as HttpMethod;
      pathStr = m[2] ?? null;
    } else {
      return null;
    }
  } else if (/^\/[^\s]*$/.test(t)) {
    pathStr = t;
  } else {
    return null;
  }
  if (!pathStr) return null;

  const httpSpec: HttpTestSpec = {
    method,
    path: pathStr,
  };

  // Extract expected status from `then` — "returns 400", "responds 200", "404".
  const statusMatch = /\b(\d{3})\b/.exec(spec.then);
  if (statusMatch) {
    const n = Number(statusMatch[1]);
    if (n >= 100 && n < 600) {
      httpSpec.expectedStatus = n;
    }
  }

  // Heuristic body for POST/PUT/PATCH: peek at `given` for JSON-shaped hints.
  // Best-effort: look for "with body { ... }" or "with email=X" patterns.
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    const bodyHint = extractBodyHint(spec.given) ?? extractBodyHint(spec.when);
    if (bodyHint !== undefined) httpSpec.body = bodyHint;
  }

  return httpSpec;
}

function extractBodyHint(text: string): unknown | undefined {
  // Look for JSON-looking substring
  const jsonMatch = /\{[^{}]*\}/.exec(text);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      /* fall through */
    }
  }
  // Look for "no <field>" → empty object signalling missing field
  if (/\bno\s+(email|password|token|user|body)\b/i.test(text)) {
    return {};
  }
  return undefined;
}

// ── LLM fallback ────────────────────────────────────────────────────────────

const LLM_SYSTEM_PROMPT =
  'You convert test specifications into HTTP test definitions. Output strict JSON only — no markdown, no preamble. Return null if the spec is not HTTP-testable.';

async function tryLlmConversion(
  spec: TestCaseSpec,
  opts: SpecToHttpOptions,
): Promise<HttpTestSpec | null> {
  const logger = opts.logger;
  const cfg = opts.criticConfig!;
  const key = opts.criticApiKey!;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const userPrompt = buildLlmPrompt(spec);

  if (logger) {
    logger.log('debug', 'agent.runtime.spec-to-http.llm-call.start', {
      specId: spec.id,
      model: cfg.modelId,
      promptLen: userPrompt.length,
    });
  }

  const caller = opts.callLLM ?? defaultSpecLlmCaller;
  let rawText: string;
  let durationMs = 0;
  try {
    const out = await caller({
      systemPrompt: LLM_SYSTEM_PROMPT,
      userPrompt,
      criticConfig: cfg,
      apiKey: key,
      timeoutMs,
    });
    rawText = out.rawText;
    durationMs = out.durationMs;
    if (logger) {
      logger.log('debug', 'agent.runtime.spec-to-http.llm-call.success', {
        specId: spec.id,
        model: cfg.modelId,
        rawLen: rawText.length,
        durationMs,
      });
    }
  } catch (err) {
    logCatch(logger, 'agent.runtime.spec-to-http.llm-call.failure', err, {
      specId: spec.id,
    });
    return null;
  }

  return parseLlmConversion(rawText, logger, spec.id);
}

function buildLlmPrompt(spec: TestCaseSpec): string {
  return [
    'Given this test spec, convert it to an HTTP test if possible. Output strict JSON.',
    '',
    'If HTTP-testable, output:',
    '  {"method": "GET"|"POST"|"PUT"|"DELETE"|"PATCH",',
    '   "path": "/api/...",',
    '   "body": <json or null>,',
    '   "expectedStatus": <number or null>,',
    '   "expectedBodyShape": <json or null>}',
    '',
    'If NOT HTTP-testable (e.g. pure function, internal flow), output: null',
    '',
    'Test spec:',
    JSON.stringify(
      {
        id: spec.id,
        name: spec.name,
        category: spec.category,
        scope: spec.scope,
        given: spec.given,
        when: spec.when,
        then: spec.then,
      },
      null,
      2,
    ),
  ].join('\n');
}

function parseLlmConversion(
  rawText: string,
  logger: TrackLogger | null | undefined,
  specId: string,
): HttpTestSpec | null {
  let cleaned = (rawText ?? '').trim();
  // strip <think>…</think> and markdown fences
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();

  // Allow explicit `null` response
  if (cleaned === 'null') {
    logBranch(logger, 'agent.runtime.spec-to-http.llm-parse', {
      decision: 'llm-said-null',
      specId,
    });
    return null;
  }

  // Extract outermost JSON object if there is preamble
  if (!cleaned.startsWith('{')) {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) cleaned = m[0];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    logCatch(logger, 'agent.runtime.spec-to-http.llm-parse', e, { specId });
    return null;
  }
  if (parsed === null) return null;

  if (typeof parsed !== 'object') {
    logBranch(logger, 'agent.runtime.spec-to-http.llm-parse', {
      decision: 'invalid-shape',
      specId,
      reasoning: 'not an object',
    });
    return null;
  }
  const rec = parsed as Record<string, unknown>;
  const method = rec.method;
  const pathV = rec.path;
  if (
    typeof method !== 'string' ||
    !(HTTP_METHODS as readonly string[]).includes(method) ||
    typeof pathV !== 'string' ||
    !pathV.startsWith('/')
  ) {
    logBranch(logger, 'agent.runtime.spec-to-http.llm-parse', {
      decision: 'invalid-shape',
      specId,
      reasoning: 'method or path invalid',
      method,
      path: pathV,
    });
    return null;
  }

  const out: HttpTestSpec = {
    method: method as HttpMethod,
    path: pathV,
  };
  if (rec.body !== undefined && rec.body !== null) out.body = rec.body;
  if (typeof rec.expectedStatus === 'number' && rec.expectedStatus >= 100 && rec.expectedStatus < 600) {
    out.expectedStatus = rec.expectedStatus;
  }
  if (rec.expectedBodyShape !== undefined && rec.expectedBodyShape !== null) {
    out.expectedBodyShape = rec.expectedBodyShape;
  }
  logBranch(logger, 'agent.runtime.spec-to-http.llm-parse', {
    decision: 'ok',
    specId,
    method: out.method,
    path: out.path,
  });
  return out;
}

const defaultSpecLlmCaller: SpecLlmCaller = async ({
  systemPrompt,
  userPrompt,
  criticConfig,
  apiKey,
  timeoutMs,
}) => {
  if (!criticConfig.baseUrl) {
    throw new Error('criticConfig.baseUrl required for default spec LLM caller');
  }
  const url = criticConfig.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const start = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: criticConfig.modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  const durationMs = Date.now() - start;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const env = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
  const content = env.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content) {
    throw new Error('response missing choices[0].message.content');
  }
  return { rawText: content, durationMs };
};
