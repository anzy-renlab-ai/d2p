/**
 * Cross-Engine Reviewer Protocol — reviewFinding + reviewBatch.
 *
 * Surface authority: docs/details/14-protocol-1-public-surface.md
 *
 * Behavior contract:
 *   B-2-1 — non-cross-family policy short-circuits to critic-unavailable
 *           (unless allowDegraded:true).
 *   B-2-2 — cross-family confirmed verdict round-trip with CriticInfo populated.
 *   B-2-3 — needs-context + empty/missing requiredContext → coerced to
 *           false-positive (requiredContext: null), with
 *           critic.coerced-empty-context-to-fp warn log.
 *   B-2-4 — transport error → critic-unavailable + critic.invocation-failure
 *           error log with errorCode P1-E-2.
 *   B-2-5 — malformed JSON → critic-unavailable + critic.response-parse-failure
 *           error log with errorCode P1-E-3, raw ≤500 chars.
 *   B-3-1 — batch logs critic.batch.start / .progress / .success.
 *   B-3-2 — costCap throttle: after costSoFar >= costCap, concurrency drops
 *           to 1 + critic.cost-cap-throttle warn entry emitted.
 *   B-3-3 — cost cap exhausted mid-batch → suffix findings get verdict
 *           critic-unavailable + reasoning 'cost-cap-exhausted'.
 *
 * Self-emitted log events under track='critic' (always — per surface).
 */

import {
  createTrackLogger,
  type TrackLogger,
} from '../../log/track-logger.js';
import { engineFamily } from './router.js';
import type {
  CriticInfo,
  CriticPolicy,
  Finding,
  MinimalCriticEngineSurface,
  Verdict,
  VerdictedFinding,
} from './types.js';

// ── Public option shapes ────────────────────────────────────────────────────

export interface ReviewContext {
  cwd: string;
  repoSha: string | null;
  /** Read the audited file's contents (the impl supplies a default that reads from disk). */
  readFile?: (path: string) => Promise<string>;
}

export interface ReviewOptions {
  logger?: TrackLogger;
  /** Override "critic-unavailable on same-family" short-circuit (default: false). */
  allowDegraded?: boolean;
}

export interface BatchOptions extends ReviewOptions {
  /** Concurrent in-flight critic calls. Default: 5. */
  concurrency?: number;
  /** Stop spending after this USD threshold. Default: Infinity. */
  costCap?: number;
}

// ── Internal helpers ────────────────────────────────────────────────────────

const MAX_RAW_LOG_LENGTH = 500;

/**
 * Per surface §"Logger track resolution": Protocol-1 ALWAYS emits under
 * track='critic'. When opts.logger is supplied, inherit its trace via
 * parentTrace; otherwise generate a fresh ULID. Never call opts.logger.child()
 * (would inherit caller's track).
 */
function resolveCriticLogger(opts?: ReviewOptions): TrackLogger {
  // minLevel: 'debug' so critic.batch.progress (level=debug) reaches observers.
  // Per surface §"Self-emitted log events": batch.progress is debug-level and
  // surface promises ≥1 progress entry in B-3-1.
  if (opts?.logger) {
    return createTrackLogger('critic', {
      parentTrace: opts.logger.trace,
      minLevel: 'debug',
    });
  }
  return createTrackLogger('critic', { minLevel: 'debug' });
}

interface ParsedCriticResponse {
  verdict: 'confirmed' | 'false-positive' | 'needs-context';
  reasoning: string;
  requiredContext?: string[];
}

function tryParseCriticJson(raw: string): ParsedCriticResponse | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const verdict = o.verdict;
  if (
    verdict !== 'confirmed' &&
    verdict !== 'false-positive' &&
    verdict !== 'needs-context'
  ) {
    return null;
  }
  const reasoning = typeof o.reasoning === 'string' ? o.reasoning : '';
  let requiredContext: string[] | undefined;
  if (Array.isArray(o.requiredContext)) {
    requiredContext = o.requiredContext.filter((x): x is string => typeof x === 'string');
  }
  return { verdict, reasoning, requiredContext };
}

/**
 * Render the prompt sent to the critic engine. The critic returns a JSON
 * object per surface §"Verdict response schema". Prompt is straightforward —
 * the critic decides whether the finding is real, FP, or needs more context.
 */
function renderCriticPrompt(finding: Finding): string {
  return [
    'You are a code-review critic. A static-analysis preset has flagged the',
    'following potential finding. Your job: decide whether it is real,',
    'a false positive, or whether you need more context.',
    '',
    'Return a JSON object with this exact shape (no markdown, no extra text):',
    '{',
    '  "verdict": "confirmed" | "false-positive" | "needs-context",',
    '  "reasoning": string (≤500 chars),',
    '  "requiredContext"?: string[] (REQUIRED iff verdict === "needs-context")',
    '}',
    '',
    `Preset:        ${finding.presetId}`,
    `Rule:          ${finding.ruleId}`,
    `Severity:      ${finding.severity}`,
    `File:          ${finding.file}:${finding.line}`,
    `Evidence:      ${finding.evidence}`,
    `Message:       ${finding.message}`,
    finding.remediationHint
      ? `Remediation:   ${finding.remediationHint}`
      : '(no remediation hint)',
    '',
    'Return JSON only.',
  ].join('\n');
}

function buildCriticInfo(
  policy: CriticPolicy,
  meta: { kind: string; modelId: string; releaseDate: string },
  costUsd: number | null,
): CriticInfo {
  return {
    kind: meta.kind,
    modelId: meta.modelId,
    releaseDate: meta.releaseDate,
    family: engineFamily(policy.critic),
    costUsd,
  };
}

function makeUnavailable(
  finding: Finding,
  reasoning: string,
): VerdictedFinding {
  return {
    ...finding,
    verdict: 'critic-unavailable',
    critic: null,
    reasoning,
    requiredContext: null,
    version: '1.0',
  };
}

// ── reviewFinding ───────────────────────────────────────────────────────────

/**
 * Single-finding critic review. Per surface §"Behavior contract" B-2.
 *
 * P1-E-1: SYNCHRONOUS throw if policy is null/undefined. Per surface §"Error
 * codes": "Synchronous throw. No log entry is emitted (the throw happens
 * before any logging); caller logs the misuse if desired." Function is
 * intentionally NOT declared `async` so the validation throw happens on the
 * caller's stack rather than via promise rejection.
 */
export function reviewFinding(
  finding: Finding,
  ctx: ReviewContext,
  policy: CriticPolicy,
  opts?: ReviewOptions,
): Promise<VerdictedFinding> {
  if (policy === null || policy === undefined) {
    throw new Error('P1-E-1: reviewFinding called with null/undefined policy');
  }

  const logger = resolveCriticLogger(opts);
  return reviewFindingWithLogger(finding, ctx, policy, logger, opts);
}

/**
 * Internal entry-point used by reviewBatch — re-uses a single critic logger
 * across N findings so all events share the same trace.
 */
async function reviewFindingWithLogger(
  finding: Finding,
  _ctx: ReviewContext,
  policy: CriticPolicy,
  logger: TrackLogger,
  opts: ReviewOptions | undefined,
): Promise<VerdictedFinding> {
  const allowDegraded = opts?.allowDegraded === true;
  const skipCritic = !policy.crossFamily && !allowDegraded;

  const startedAt = Date.now();

  logger.log('info', 'critic.review.start', {
    findingId: finding.id,
    presetId: finding.presetId,
    ruleId: finding.ruleId,
    crossFamily: policy.crossFamily,
  });

  if (skipCritic) {
    const result = makeUnavailable(
      finding,
      `policy.reason=${policy.reason}; allowDegraded=false`,
    );
    logger.log('info', 'critic.review.success', {
      findingId: finding.id,
      verdict: 'critic-unavailable' as Verdict,
      criticFamily: null,
      durationMs: Date.now() - startedAt,
    });
    return result;
  }

  // Invoke the critic engine.
  const engine: MinimalCriticEngineSurface = policy.criticEngine;
  const prompt = renderCriticPrompt(finding);

  let raw: string;
  try {
    raw = await engine.call(prompt);
  } catch (err) {
    const errMsg = (err as Error)?.message ?? String(err);
    logger.log('error', 'critic.invocation-failure', {
      findingId: finding.id,
      errorCode: 'P1-E-2',
      error: errMsg,
    });
    const result = makeUnavailable(finding, errMsg);
    logger.log('info', 'critic.review.success', {
      findingId: finding.id,
      verdict: 'critic-unavailable' as Verdict,
      criticFamily: null,
      durationMs: Date.now() - startedAt,
    });
    return result;
  }

  // Capture cost synchronously immediately after call() resolves (per surface
  // §"lastCallCostUsd() concurrency").
  let costUsd: number | null = null;
  try {
    costUsd = engine.lastCallCostUsd();
  } catch {
    costUsd = null;
  }

  const meta = engine.getMeta();
  const parsed = tryParseCriticJson(raw);

  if (!parsed) {
    const truncated = raw.length > MAX_RAW_LOG_LENGTH ? raw.slice(0, MAX_RAW_LOG_LENGTH) : raw;
    logger.log('error', 'critic.response-parse-failure', {
      findingId: finding.id,
      errorCode: 'P1-E-3',
      raw: truncated,
    });
    const result = makeUnavailable(finding, 'critic returned unparseable response');
    logger.log('info', 'critic.review.success', {
      findingId: finding.id,
      verdict: 'critic-unavailable' as Verdict,
      criticFamily: null,
      durationMs: Date.now() - startedAt,
    });
    return result;
  }

  // Coerce: needs-context + empty/missing requiredContext → false-positive.
  let verdict: Verdict = parsed.verdict;
  let requiredContext: string[] | null = parsed.requiredContext && parsed.requiredContext.length > 0
    ? parsed.requiredContext
    : null;

  if (parsed.verdict === 'needs-context' && requiredContext === null) {
    verdict = 'false-positive';
    requiredContext = null;
    logger.log('warn', 'critic.coerced-empty-context-to-fp', {
      findingId: finding.id,
    });
  }

  // For non-needs-context verdicts, requiredContext MUST be null (invariant).
  if (verdict !== 'needs-context') {
    requiredContext = null;
  }

  const critic = buildCriticInfo(policy, meta, costUsd);

  const result: VerdictedFinding = {
    ...finding,
    verdict,
    critic,
    reasoning: parsed.reasoning,
    requiredContext,
    version: '1.0',
  };

  logger.log('info', 'critic.review.success', {
    findingId: finding.id,
    verdict,
    criticFamily: critic.family,
    durationMs: Date.now() - startedAt,
  });

  return result;
}

// ── reviewBatch ─────────────────────────────────────────────────────────────

/**
 * Concurrency-controlled, cost-capped batch review. Surface §B-3.
 *
 * Cost-cap evaluation: post-call accounting (per surface §"Cost-cap evaluation
 * semantics"). Throttle fires inclusive (`costSoFar >= costCap`). Empty-input
 * batch is a no-op resolving to [] with batch.start{total:0}/batch.success{...}
 * events.
 */
export async function reviewBatch(
  findings: Finding[],
  ctx: ReviewContext,
  policy: CriticPolicy,
  opts?: BatchOptions,
): Promise<VerdictedFinding[]> {
  if (policy === null || policy === undefined) {
    throw new Error('P1-E-1: reviewBatch called with null/undefined policy');
  }

  const logger = resolveCriticLogger(opts);
  const concurrencyInitial = opts?.concurrency ?? 5;
  const costCap = opts?.costCap ?? Infinity;
  const total = findings.length;
  const startedAt = Date.now();

  // Per surface §"Cost-cap evaluation semantics": logged costCap is null
  // when no cap supplied (Infinity).
  const loggedCostCap = Number.isFinite(costCap) ? costCap : null;

  logger.log('info', 'critic.batch.start', {
    total,
    concurrency: concurrencyInitial,
    costCap: loggedCostCap,
  });

  // Empty-input batch — short-circuit per surface §"Empty-input batch contract".
  if (total === 0) {
    logger.log('info', 'critic.batch.success', {
      total: 0,
      confirmed: 0,
      falsePositive: 0,
      needsContext: 0,
      criticUnavailable: 0,
      durationMs: Date.now() - startedAt,
    });
    return [];
  }

  // Concurrent worker queue with mid-batch throttle.
  const results: (VerdictedFinding | undefined)[] = new Array(total);
  let nextIndex = 0;
  let costSoFar = 0;
  let throttled = false;
  let capExhausted = false;
  let doneCount = 0;

  async function workerLoop(): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (capExhausted) return;
      const i = nextIndex++;
      if (i >= total) return;

      const finding = findings[i]!;
      const result = await reviewFindingWithLogger(finding, ctx, policy, logger, opts);
      results[i] = result;

      // Post-call cost accounting (per surface §"Cost-cap evaluation semantics").
      if (result.critic && typeof result.critic.costUsd === 'number') {
        costSoFar += result.critic.costUsd;
      }
      doneCount += 1;

      logger.log('debug', 'critic.batch.progress', {
        done: doneCount,
        total,
        costSoFar,
      });

      // Throttle: when costSoFar >= costCap, drop concurrency to 1.
      if (!throttled && costSoFar >= costCap) {
        throttled = true;
        logger.log('warn', 'critic.cost-cap-throttle', {
          costSoFar,
          costCap,
        });
      }

      // Cap exhaustion: post-call check; subsequent findings get critic-unavailable.
      if (!capExhausted && costSoFar >= costCap && nextIndex < total) {
        // If cap was supplied finite AND we're at cap, mark remaining as unavailable.
        if (Number.isFinite(costCap)) {
          capExhausted = true;
          const remaining = total - nextIndex;
          logger.log('error', 'critic.batch-cost-cap-exhausted', {
            remaining,
            costSoFar,
            costCap,
          });
        }
      }
    }
  }

  // Phase 1 — concurrent dispatch up to concurrencyInitial workers. When
  // throttle fires, all currently in-flight calls finish; new calls go serial
  // because once `throttled === true`, the workers below detect it and bail
  // to a serial loop.
  //
  // Implementation strategy: kick off concurrencyInitial workers; each runs
  // until total exhausted or cap exhausted. After the FIRST one observes
  // throttled (i.e. its tick saw costSoFar >= costCap), we DON'T need to
  // tear down other workers — they will naturally drain by the time the
  // throttle predicate is checked. But to enforce serial semantics AFTER
  // throttle, we use a single-worker bottleneck: split into a phase-1 loop
  // of N workers that exits as soon as `throttled === true`, then a phase-2
  // single-worker loop.
  //
  // To implement that without altering the surface, we use a soft-stop:
  // each worker bails out early as soon as it detects throttled.

  async function phase1Worker(): Promise<void> {
    while (true) {
      if (capExhausted) return;
      if (throttled) return; // hand off to phase-2 serial loop
      const i = nextIndex;
      if (i >= total) return;
      nextIndex = i + 1;

      const finding = findings[i]!;
      const result = await reviewFindingWithLogger(finding, ctx, policy, logger, opts);
      results[i] = result;

      if (result.critic && typeof result.critic.costUsd === 'number') {
        costSoFar += result.critic.costUsd;
      }
      doneCount += 1;

      logger.log('debug', 'critic.batch.progress', {
        done: doneCount,
        total,
        costSoFar,
      });

      if (!throttled && costSoFar >= costCap) {
        throttled = true;
        logger.log('warn', 'critic.cost-cap-throttle', {
          costSoFar,
          costCap,
        });
      }

      if (!capExhausted && costSoFar >= costCap && nextIndex < total) {
        if (Number.isFinite(costCap)) {
          capExhausted = true;
          const remaining = total - nextIndex;
          logger.log('error', 'critic.batch-cost-cap-exhausted', {
            remaining,
            costSoFar,
            costCap,
          });
        }
      }
    }
  }

  async function phase2SerialLoop(): Promise<void> {
    while (true) {
      if (capExhausted) return;
      const i = nextIndex;
      if (i >= total) return;
      nextIndex = i + 1;

      const finding = findings[i]!;
      const result = await reviewFindingWithLogger(finding, ctx, policy, logger, opts);
      results[i] = result;

      if (result.critic && typeof result.critic.costUsd === 'number') {
        costSoFar += result.critic.costUsd;
      }
      doneCount += 1;

      logger.log('debug', 'critic.batch.progress', {
        done: doneCount,
        total,
        costSoFar,
      });

      if (!capExhausted && costSoFar >= costCap && nextIndex < total) {
        if (Number.isFinite(costCap)) {
          capExhausted = true;
          const remaining = total - nextIndex;
          logger.log('error', 'critic.batch-cost-cap-exhausted', {
            remaining,
            costSoFar,
            costCap,
          });
        }
      }
    }
  }

  // Suppress unused-var warning for workerLoop (kept for reference / linter
  // ergonomic — phase1 + phase2 are the live implementation).
  void workerLoop;

  // Phase 1 — concurrent.
  const nWorkers = Math.min(concurrencyInitial, total);
  await Promise.all(Array.from({ length: nWorkers }, () => phase1Worker()));

  // Phase 2 — strictly serial after throttle (or if there's still queue).
  while (!capExhausted && nextIndex < total) {
    await phase2SerialLoop();
  }

  // Fill any remaining slots with cost-cap-exhausted critic-unavailable.
  for (let i = 0; i < total; i++) {
    if (!results[i]) {
      results[i] = makeUnavailable(findings[i]!, 'cost-cap-exhausted');
    }
  }

  // Aggregate verdict counts for batch.success.
  const finalResults = results as VerdictedFinding[];
  let confirmed = 0;
  let falsePositive = 0;
  let needsContext = 0;
  let criticUnavailable = 0;
  for (const r of finalResults) {
    if (r.verdict === 'confirmed') confirmed += 1;
    else if (r.verdict === 'false-positive') falsePositive += 1;
    else if (r.verdict === 'needs-context') needsContext += 1;
    else criticUnavailable += 1;
  }

  logger.log('info', 'critic.batch.success', {
    total,
    confirmed,
    falsePositive,
    needsContext,
    criticUnavailable,
    durationMs: Date.now() - startedAt,
  });

  return finalResults;
}
