/**
 * Consolidated OpenAI-Chat-Completions fetcher with retry + jitter backoff.
 *
 * Phase 11.1 — Audit Parallelization.
 *
 * Replaces four duplicated `defaultLlmCaller`/`defaultEmitLlmCaller`/
 * `defaultTestGenLlm` implementations in:
 *   - critic-client.ts
 *   - test-spec-runner.ts
 *   - test-emitter.ts
 *   - test-case-generator.ts
 *
 * Retry policy (defaults):
 *   - 3 attempts max, base 500ms, max 8s, full jitter ±30%.
 *   - 429 / 5xx / network reset / timeout → retry with backoff
 *   - 429 honors `Retry-After` header (seconds → ms)
 *   - 4xx (non-429) / JSON parse / missing content → fail fast
 *   - AbortError → fail fast (no retry)
 *
 * Emits `<branchPrefix>.attempt.start/success/failure/retry` events when
 * `branchPrefix` is supplied; default `agent.llm-fetch`.
 */
import type { TrackLogger } from '../log-types.js';
import { logBranch } from '../log/branch.js';

export interface LlmFetchArgs {
  /** Absolute URL OR `<baseUrl>/chat/completions` — caller's choice. */
  url: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs: number;
  /** Default 0 (deterministic). */
  temperature?: number;
  /** Caller-supplied abort signal (e.g. for SIGINT). */
  signal?: AbortSignal;
  retry?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    /** 0..1, default 0.3. */
    jitterPct?: number;
  };
  logger?: TrackLogger;
  /** Event prefix. Default `agent.llm-fetch`. */
  branchPrefix?: string;
  /** Test seam — inject a fake fetch. Default = global fetch. */
  fetchImpl?: typeof fetch;
  /** Test seam — inject a fake sleep. Default = setTimeout. */
  sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface LlmFetchOk {
  ok: true;
  /** Assistant content (already unwrapped from envelope.choices[0].message.content). */
  rawText: string;
  durationMs: number;
  attempts: number;
}

export interface LlmFetchErr {
  ok: false;
  error: string;
  statusCode?: number;
  durationMs: number;
  attempts: number;
}

const DEFAULT_PREFIX = 'agent.llm-fetch';
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8_000;
const DEFAULT_JITTER_PCT = 0.3;

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function parseRetryAfter(headerValue: string | null | undefined): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  // Numeric seconds
  const n = Number(trimmed);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n * 1000);
  // HTTP-date — best effort.
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }
  return null;
}

function computeBackoff(
  attempt: number,
  base: number,
  cap: number,
  jitterPct: number,
): number {
  // Exponential: base * 2^(attempt-1). attempt is 1-indexed.
  const raw = base * Math.pow(2, Math.max(0, attempt - 1));
  const capped = Math.min(raw, cap);
  const jitter = (Math.random() * 2 - 1) * jitterPct * capped;
  return Math.max(0, Math.floor(capped + jitter));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message));
}

/**
 * Fetch a chat completion with retry + jitter backoff. Never throws —
 * always returns `LlmFetchOk | LlmFetchErr`.
 */
export async function fetchLlm(args: LlmFetchArgs): Promise<LlmFetchOk | LlmFetchErr> {
  const start = Date.now();
  const prefix = args.branchPrefix ?? DEFAULT_PREFIX;
  const log = args.logger;
  const fetchImpl = args.fetchImpl ?? fetch;
  const sleep = args.sleepImpl ?? defaultSleep;
  const maxAttempts = args.retry?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelay = args.retry?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelay = args.retry?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const jitterPct = args.retry?.jitterPct ?? DEFAULT_JITTER_PCT;

  const body = JSON.stringify({
    model: args.model,
    messages: [
      { role: 'system', content: args.systemPrompt },
      { role: 'user', content: args.userPrompt },
    ],
    temperature: args.temperature ?? 0,
    stream: false,
  });

  let attempt = 0;
  let lastError = 'unknown error';
  let lastStatus: number | undefined;

  while (attempt < maxAttempts) {
    attempt++;

    // Abort check before each attempt.
    if (args.signal?.aborted) {
      logBranch(log, `${prefix}.attempt.failure`, {
        decision: 'aborted-before-attempt',
        attempt,
        attempts: attempt,
      });
      return {
        ok: false,
        error: 'aborted',
        durationMs: Date.now() - start,
        attempts: attempt,
      };
    }

    logBranch(log, `${prefix}.attempt.start`, {
      decision: 'attempt-start',
      url: args.url,
      model: args.model,
      attempt,
    });

    // Build per-attempt signal that combines user signal + timeout.
    const signals: AbortSignal[] = [];
    if (args.signal) signals.push(args.signal);
    signals.push(AbortSignal.timeout(args.timeoutMs));
    const combined = signals.length === 1 ? signals[0]! : AbortSignal.any(signals);

    let res: Response;
    try {
      res = await fetchImpl(args.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${args.apiKey}`,
        },
        body,
        signal: combined,
      });
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      const aborted = isAbortError(e);
      // User-triggered abort: fail fast, no retry.
      if (aborted && args.signal?.aborted) {
        logBranch(log, `${prefix}.attempt.failure`, {
          decision: 'user-abort',
          attempt,
          attempts: attempt,
          reason: msg.slice(0, 200),
        });
        return {
          ok: false,
          error: 'aborted',
          durationMs: Date.now() - start,
          attempts: attempt,
        };
      }
      // Timeout or network — retry if we have attempts left.
      lastError = msg.slice(0, 300);
      if (attempt >= maxAttempts) {
        logBranch(log, `${prefix}.attempt.failure`, {
          decision: 'network-or-timeout-final',
          attempt,
          attempts: attempt,
          reason: lastError,
        });
        return {
          ok: false,
          error: lastError,
          durationMs: Date.now() - start,
          attempts: attempt,
        };
      }
      const delay = computeBackoff(attempt, baseDelay, maxDelay, jitterPct);
      logBranch(log, `${prefix}.attempt.retry`, {
        decision: 'retry-after-network-error',
        attempt,
        reason: lastError,
        retryAfterMs: delay,
      });
      try {
        await sleep(delay, args.signal);
      } catch {
        return {
          ok: false,
          error: 'aborted',
          durationMs: Date.now() - start,
          attempts: attempt,
        };
      }
      continue;
    }

    // We got an HTTP response.
    const text = await res.text();
    lastStatus = res.status;

    if (!res.ok) {
      if (isRetryableStatus(res.status) && attempt < maxAttempts) {
        let retryAfterMs: number | null = null;
        if (res.status === 429) {
          retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
        }
        const delay =
          retryAfterMs ?? computeBackoff(attempt, baseDelay, maxDelay, jitterPct);
        logBranch(log, `${prefix}.attempt.retry`, {
          decision: 'retry-after-http-error',
          attempt,
          statusCode: res.status,
          retryAfterMs: delay,
          honoredRetryAfter: retryAfterMs !== null,
          reason: `HTTP ${res.status}`,
        });
        try {
          await sleep(delay, args.signal);
        } catch {
          return {
            ok: false,
            error: 'aborted',
            durationMs: Date.now() - start,
            attempts: attempt,
          };
        }
        lastError = `HTTP ${res.status}: ${text.slice(0, 200)}`;
        continue;
      }
      // Non-retryable 4xx, or out of attempts.
      const errMsg = `HTTP ${res.status}: ${text.slice(0, 200)}`;
      logBranch(log, `${prefix}.attempt.failure`, {
        decision: isRetryableStatus(res.status) ? 'retryable-exhausted' : 'non-retryable-status',
        attempt,
        attempts: attempt,
        statusCode: res.status,
      });
      return {
        ok: false,
        error: errMsg,
        statusCode: res.status,
        durationMs: Date.now() - start,
        attempts: attempt,
      };
    }

    // 2xx response — try to parse envelope.
    let envelope: unknown;
    try {
      envelope = JSON.parse(text);
    } catch {
      logBranch(log, `${prefix}.attempt.failure`, {
        decision: 'envelope-not-json',
        attempt,
        attempts: attempt,
      });
      return {
        ok: false,
        error: 'response envelope not valid JSON',
        statusCode: res.status,
        durationMs: Date.now() - start,
        attempts: attempt,
      };
    }
    const content = (envelope as { choices?: Array<{ message?: { content?: string } }> })
      .choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      logBranch(log, `${prefix}.attempt.failure`, {
        decision: 'missing-content',
        attempt,
        attempts: attempt,
      });
      return {
        ok: false,
        error: 'response missing choices[0].message.content',
        statusCode: res.status,
        durationMs: Date.now() - start,
        attempts: attempt,
      };
    }
    const durationMs = Date.now() - start;
    logBranch(log, `${prefix}.attempt.success`, {
      decision: 'success',
      attempt,
      attempts: attempt,
      durationMs,
      rawLen: content.length,
    });
    return {
      ok: true,
      rawText: content,
      durationMs,
      attempts: attempt,
    };
  }

  // Should be unreachable; the while loop always returns. Defensive fallback.
  return {
    ok: false,
    error: lastError,
    statusCode: lastStatus,
    durationMs: Date.now() - start,
    attempts: attempt,
  };
}
