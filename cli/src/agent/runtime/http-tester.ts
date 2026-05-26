/**
 * Sends one HTTP request, compares the response with expected, returns a
 * HttpTestResult (Phase 6 §http-tester).
 *
 * Body-shape assertion (v1):
 *   `expectedBodyShape` is treated as a "JSON contains" matcher. For each
 *   key in the expected shape (recursively for nested objects), the actual
 *   body must have the same value (==). Arrays are matched element-wise by
 *   index. Extra fields in `actualBody` do NOT cause a fail.
 *
 * Emits:
 *   - agent.runtime.http.request.start { method, path, baseUrl }
 *   - agent.runtime.http.response { status, durationMs, bodyPreview }
 *   - agent.runtime.http.assert.status-decision { expected, actual, pass }
 *   - agent.runtime.http.assert.body-decision { match, mismatchPath }
 *   - agent.runtime.http.complete { status, verdictReason }
 */
import type { TrackLogger } from '../../log-types.js';
import { logBranch, logCatch } from '../../log/branch.js';
import type { HttpTestResult, HttpTestSpec, RuntimeProcess } from './types.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const BODY_PREVIEW_LEN = 200;

export interface HttpTestOptions {
  /** Per-request timeout override (default 5s). */
  timeoutMs?: number;
}

export async function runHttpTest(
  spec: HttpTestSpec,
  runtime: RuntimeProcess,
  logger?: TrackLogger | null,
  opts?: HttpTestOptions,
): Promise<HttpTestResult> {
  const start = Date.now();
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const url = joinUrl(runtime.baseUrl, spec.path);

  if (logger) {
    logger.log('info', 'agent.runtime.http.request.start', {
      method: spec.method,
      path: spec.path,
      url,
      baseUrl: runtime.baseUrl,
      hasBody: spec.body !== undefined,
    });
  }

  let actualStatus = 0;
  let actualBody: unknown = undefined;
  let actualHeaders: Record<string, string> = {};

  try {
    const headers: Record<string, string> = { ...(spec.headers ?? {}) };
    let bodyBuf: string | undefined;
    if (spec.body !== undefined) {
      bodyBuf = typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body);
      if (!headers['content-type'] && !headers['Content-Type']) {
        headers['content-type'] = 'application/json';
      }
    }
    const res = await fetch(url, {
      method: spec.method,
      headers,
      body: bodyBuf,
      signal: AbortSignal.timeout(timeoutMs),
    });
    actualStatus = res.status;
    actualHeaders = Object.fromEntries(res.headers.entries());
    const text = await res.text();
    actualBody = parseBody(text, actualHeaders['content-type']);

    if (logger) {
      logger.log('info', 'agent.runtime.http.response', {
        status: actualStatus,
        durationMs: Date.now() - start,
        bodyPreview: text.slice(0, BODY_PREVIEW_LEN),
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logCatch(logger, 'agent.runtime.http.request.error', err, {
      url,
      method: spec.method,
    });
    const result: HttpTestResult = {
      spec,
      status: 'inconclusive',
      verdictReason: `http request failed: ${msg.slice(0, 200)}`,
      durationMs: Date.now() - start,
    };
    if (logger) {
      logger.log('warn', 'agent.runtime.http.complete', {
        status: 'inconclusive',
        verdictReason: result.verdictReason,
      });
    }
    return result;
  }

  // Status assertion
  let statusOk = true;
  let statusReason = '';
  if (spec.expectedStatus !== undefined) {
    statusOk = actualStatus === spec.expectedStatus;
    statusReason = statusOk
      ? `status ${actualStatus} matched expected`
      : `status ${actualStatus} ≠ expected ${spec.expectedStatus}`;
    logBranch(
      logger,
      'agent.runtime.http.assert.status-decision',
      {
        decision: statusOk ? 'pass' : 'fail',
        expected: spec.expectedStatus,
        actual: actualStatus,
      },
      { level: 'info' },
    );
  }

  // Body assertion
  let bodyOk = true;
  let bodyReason = '';
  let mismatchPath: string | undefined;
  if (spec.expectedBodyShape !== undefined) {
    const cmp = matchShape(actualBody, spec.expectedBodyShape, '$');
    bodyOk = cmp.ok;
    mismatchPath = cmp.path;
    bodyReason = cmp.ok
      ? 'body shape matched'
      : `body shape mismatch at ${cmp.path}: ${cmp.reason}`;
    logBranch(
      logger,
      'agent.runtime.http.assert.body-decision',
      {
        decision: bodyOk ? 'pass' : 'fail',
        match: bodyOk,
        mismatchPath,
      },
      { level: 'info' },
    );
  }

  const pass = statusOk && bodyOk;
  const reasonParts: string[] = [];
  if (statusReason) reasonParts.push(statusReason);
  if (bodyReason) reasonParts.push(bodyReason);
  if (reasonParts.length === 0) {
    reasonParts.push(`no assertions configured; status=${actualStatus}`);
  }
  const verdictReason = reasonParts.join('; ');

  const result: HttpTestResult = {
    spec,
    status: pass ? 'pass' : 'fail',
    actualStatus,
    actualBody,
    actualHeaders,
    verdictReason,
    durationMs: Date.now() - start,
  };

  if (logger) {
    logger.log(pass ? 'info' : 'warn', 'agent.runtime.http.complete', {
      status: result.status,
      verdictReason,
      actualStatus,
    });
  }
  return result;
}

function joinUrl(base: string, path: string): string {
  const baseTrim = base.replace(/\/+$/, '');
  const pathTrim = path.startsWith('/') ? path : '/' + path;
  return baseTrim + pathTrim;
}

function parseBody(text: string, contentType?: string): unknown {
  if (!text) return undefined;
  // Try JSON first if hint says so, then opportunistically.
  if (contentType && /json/i.test(contentType)) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  // Opportunistic JSON parse for non-typed responses.
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

/**
 * Recursive "contains" matcher.
 *   - Primitives must equal (===).
 *   - Objects: every key in expected must exist in actual and match
 *     recursively. Extra keys in actual are ignored.
 *   - Arrays: same length OR expected.length ≤ actual.length, matched by
 *     index. (v1 keeps it simple — no "contains element" set semantics.)
 */
export interface ShapeMatchResult {
  ok: boolean;
  path?: string;
  reason?: string;
}

export function matchShape(actual: unknown, expected: unknown, path: string): ShapeMatchResult {
  if (expected === null || expected === undefined) {
    if (actual === expected) return { ok: true };
    return { ok: false, path, reason: `expected ${String(expected)} got ${typeof actual}` };
  }
  const eType = typeof expected;
  if (eType === 'number' || eType === 'boolean' || eType === 'string') {
    if (actual === expected) return { ok: true };
    return {
      ok: false,
      path,
      reason: `expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`,
    };
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return { ok: false, path, reason: `expected array got ${typeof actual}` };
    }
    if (actual.length < expected.length) {
      return {
        ok: false,
        path,
        reason: `expected length ≥ ${expected.length} got ${actual.length}`,
      };
    }
    for (let i = 0; i < expected.length; i++) {
      const sub = matchShape(actual[i], expected[i], `${path}[${i}]`);
      if (!sub.ok) return sub;
    }
    return { ok: true };
  }
  if (eType === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
      return { ok: false, path, reason: `expected object got ${actual === null ? 'null' : typeof actual}` };
    }
    const aObj = actual as Record<string, unknown>;
    const eObj = expected as Record<string, unknown>;
    for (const k of Object.keys(eObj)) {
      if (!(k in aObj)) {
        return { ok: false, path: `${path}.${k}`, reason: 'missing key' };
      }
      const sub = matchShape(aObj[k], eObj[k], `${path}.${k}`);
      if (!sub.ok) return sub;
    }
    return { ok: true };
  }
  return { ok: false, path, reason: `unsupported expected type ${eType}` };
}
