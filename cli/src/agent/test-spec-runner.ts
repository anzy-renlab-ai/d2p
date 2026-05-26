/**
 * Test spec runner (Phase 5).
 *
 * Surface: docs/plans/2026-05-26-phase-5-test-case-agent.md
 *          §"agent/test-spec-runner.ts"
 *
 * v1 paradigm: LLM-as-static-runner. We give the model:
 *   - the test spec (given/when/then)
 *   - the source code window around spec.scope.file:line (±30 lines)
 * and the model decides pass / fail / inconclusive with a one-line reason
 * and evidence pointer. NO process is launched; this is static analysis.
 *
 * Fallback path: if no critic key/config is supplied, every spec returns
 * status='skipped' so downstream callers always get a TestSummary.
 */
import * as fs from 'node:fs';
import path from 'node:path';
import type { TrackLogger } from '../log-types.js';
import type {
  TestCaseSpec,
  TestCaseResult,
  TestCaseStatus,
  TestSummary,
} from './types.js';
import {
  logTestCaseStart,
  logTestContextRead,
  logTestLlmCall,
  logTestResult,
} from './test-result-logger.js';
import { logBranch, logCatch } from '../log/branch.js';
import type { EngineConfig } from '../stubs.js';
import { engineFamily } from '../stubs.js';

// ── Public API ───────────────────────────────────────────────────────────────

export interface TestRunOptions {
  spec: TestCaseSpec;
  cwd: string;
  logger: TrackLogger;
  criticConfig: EngineConfig | null;
  criticApiKey: string | null;
  /**
   * Optional injectable LLM call — used by tests to avoid hitting a real
   * provider. If unset, the runner uses the built-in OpenAI-Chat-Completions
   * fetch path (mirrors `critic-client.ts`).
   */
  callLLM?: LlmCaller;
  /** Default ±30 lines around spec.scope.line. */
  contextLines?: number;
  /** Per-call timeout. Default 30s. */
  timeoutMs?: number;
}

export interface TestBatchOptions
  extends Omit<TestRunOptions, 'spec'> {
  /** Reserved for v2 — v1 runs serially regardless. */
  concurrency?: number;
}

/**
 * LLM call hook. Receives the rendered user prompt + config and returns
 * either the raw model text or throws.
 */
export type LlmCaller = (args: {
  systemPrompt: string;
  userPrompt: string;
  criticConfig: EngineConfig;
  apiKey: string;
  timeoutMs: number;
}) => Promise<{ rawText: string; durationMs: number }>;

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CONTEXT_LINES = 30;
const DEFAULT_TIMEOUT_MS = 30_000;

// Phase 9 Lite — adversarial judge. We split test-generation from
// test-evaluation by giving the evaluator an opposing role: "find reasons the
// code FAILS, default to fail unless you can quote a code line proving pass."
// We also withhold the generator's internal `reasoning` field and the spec id
// (which can leak naming intent), so the judge sees only the bare assertion
// (given/when/then) + the raw code window.
//
// Why: even though our LLM API calls are stateless (no session memory shared
// between generator and judge), same-model blind spots cause both calls to
// agree on bugs neither catches. Adversarial framing + information isolation
// is the documented best practice for LLM-as-judge (Zheng et al. 2023).
const SYSTEM_PROMPT =
  'You are an ADVERSARIAL code reviewer. Your job is to find any reason the code FAILS the given test assertion. Default verdict = fail. Pass only when you can quote the exact code lines that obviously satisfy the assertion. Bias toward skepticism. Output JSON only — no markdown fence, no preamble.';

// ── Single test case ─────────────────────────────────────────────────────────

/**
 * Run one TestCaseSpec against the codebase. Returns a verdict; never throws.
 * If the LLM call fails the result.status is 'inconclusive' with an error
 * captured in verdictReason — failures DO NOT bubble out (the batch must keep
 * going).
 */
export async function runTestCase(opts: TestRunOptions): Promise<TestCaseResult> {
  const start = Date.now();
  const { spec, logger } = opts;

  logTestCaseStart(logger, spec);

  // ── 1. Read source context ────────────────────────────────────────────────
  const ctxLines = opts.contextLines ?? DEFAULT_CONTEXT_LINES;
  // Resolve spec.scope.file against the audit cwd (it's stored as a repo-relative POSIX path).
  const absFile = path.isAbsolute(spec.scope.file)
    ? spec.scope.file
    : path.resolve(opts.cwd, spec.scope.file);
  const ctx = readContextWindow(absFile, spec.scope.line, ctxLines, logger);
  // ctx may be { snippet: '', lineStart: 0, lineEnd: 0 } if the file cannot
  // be read — we still attempt the LLM call (the file path/line may be
  // sufficient to reason about generated code) but log the degradation.
  logTestContextRead(logger, {
    file: spec.scope.file,
    lineStart: ctx.lineStart,
    lineEnd: ctx.lineEnd,
    snippet: ctx.snippet,
  });

  // ── 2. Fallback if no LLM available ──────────────────────────────────────
  if (!opts.criticConfig || !opts.criticApiKey) {
    logBranch(logger, 'agent.test-run.case.skipped', {
      decision: 'skipped',
      reason: 'no-llm-key',
      specId: spec.id,
    });
    const result: TestCaseResult = {
      spec,
      status: 'skipped',
      verdictReason: 'no critic key — cannot perform LLM static analysis',
      evidence: {
        file: spec.scope.file,
        line: spec.scope.line,
      },
      criticFamily: null,
      durationMs: Date.now() - start,
    };
    logTestResult(logger, result);
    return result;
  }

  // ── 3. Build prompt + call LLM ───────────────────────────────────────────
  const userPrompt = buildUserPrompt(spec, ctx);
  const model = opts.criticConfig.modelId;
  const family = engineFamily(opts.criticConfig);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  logTestLlmCall(logger, {
    specId: spec.id,
    model,
    promptLen: userPrompt.length,
    phase: 'start',
  });

  let rawText = '';
  let llmDuration = 0;
  const caller = opts.callLLM ?? defaultLlmCaller;
  try {
    const out = await caller({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      criticConfig: opts.criticConfig,
      apiKey: opts.criticApiKey,
      timeoutMs,
    });
    rawText = out.rawText;
    llmDuration = out.durationMs;
    logTestLlmCall(logger, {
      specId: spec.id,
      model,
      promptLen: userPrompt.length,
      phase: 'success',
      rawLen: rawText.length,
      durationMs: llmDuration,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logTestLlmCall(logger, {
      specId: spec.id,
      model,
      promptLen: userPrompt.length,
      phase: 'failure',
      error: msg,
      durationMs: Date.now() - start,
    });
    const result: TestCaseResult = {
      spec,
      status: 'inconclusive',
      verdictReason: `llm call failed: ${msg.slice(0, 200)}`,
      evidence: {
        file: spec.scope.file,
        line: spec.scope.line,
      },
      criticFamily: family,
      durationMs: Date.now() - start,
    };
    logTestResult(logger, result);
    return result;
  }

  // ── 4. Parse decision ────────────────────────────────────────────────────
  const parsed = parseDecision(rawText, logger, spec.id);
  if (!parsed.ok) {
    const result: TestCaseResult = {
      spec,
      status: 'inconclusive',
      verdictReason: `parse failure: ${parsed.error}`,
      evidence: {
        file: spec.scope.file,
        line: spec.scope.line,
      },
      criticFamily: family,
      durationMs: Date.now() - start,
    };
    logTestResult(logger, result);
    return result;
  }

  const result: TestCaseResult = {
    spec,
    status: parsed.status,
    verdictReason: parsed.verdictReason,
    evidence: {
      file: parsed.evidence.file ?? spec.scope.file,
      line: parsed.evidence.line ?? spec.scope.line,
      snippet: parsed.evidence.snippet,
      expectedBehavior: parsed.evidence.expectedBehavior,
      actualBehavior: parsed.evidence.actualBehavior,
    },
    criticFamily: family,
    durationMs: Date.now() - start,
  };
  logTestResult(logger, result);
  return result;
}

// ── Batch runner ─────────────────────────────────────────────────────────────

/**
 * Run a batch of specs serially. v1 deliberately avoids parallelism — critic
 * providers rate-limit aggressively and static-analysis prompts are slow.
 */
export async function runTestCaseBatch(
  specs: TestCaseSpec[],
  ctx: TestBatchOptions,
): Promise<{ results: TestCaseResult[]; summary: TestSummary }> {
  ctx.logger.log('info', 'agent.test-run.batch.start', {
    total: specs.length,
    hasCritic: !!(ctx.criticConfig && ctx.criticApiKey),
  });

  const results: TestCaseResult[] = [];
  for (const spec of specs) {
    const r = await runTestCase({ ...ctx, spec });
    results.push(r);
  }

  const summary = summarize(results);
  ctx.logger.log('info', 'agent.test-run.batch.complete', {
    total: summary.total,
    pass: summary.pass,
    fail: summary.fail,
    inconclusive: summary.inconclusive,
    skipped: summary.skipped,
  });

  return { results, summary };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface ContextWindow {
  snippet: string;
  lineStart: number;
  lineEnd: number;
}

function readContextWindow(
  file: string,
  centerLine: number,
  contextLines: number,
  logger: TrackLogger,
): ContextWindow {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    const lineStart = Math.max(1, centerLine - contextLines);
    const lineEnd = Math.min(lines.length, centerLine + contextLines);
    const slice = lines.slice(lineStart - 1, lineEnd);
    // Prefix each line with its line number for the LLM
    const snippet = slice
      .map((l, i) => `${String(lineStart + i).padStart(4, ' ')}: ${l}`)
      .join('\n');
    logBranch(logger, 'agent.test-run.case.context-read-decision', {
      decision: 'ok',
      file,
      lineStart,
      lineEnd,
    });
    return { snippet, lineStart, lineEnd };
  } catch (e) {
    logCatch(logger, 'agent.test-run.case.context-read-decision', e, {
      file,
      centerLine,
    });
    return { snippet: '', lineStart: 0, lineEnd: 0 };
  }
}

function buildUserPrompt(spec: TestCaseSpec, ctx: ContextWindow): string {
  // Phase 9 Lite — information isolation. We deliberately do NOT include:
  //   - spec.id      (naming intent can leak generator's framing)
  //   - spec.category (priming the judge to look for a specific class of bug)
  //   - spec.reasoning (the generator's internal "why this test matters" — the
  //     judge must reach its own conclusion from the raw assertion + code)
  return [
    'TASK: Find reasons the source code FAILS the assertion below.',
    'DEFAULT VERDICT: fail. Only return pass if you can quote the specific code',
    'line(s) that obviously satisfy the assertion. Be skeptical.',
    '',
    'Assertion:',
    `- Given: ${spec.given}`,
    `- When: ${spec.when}`,
    `- Then: ${spec.then}`,
    `- Target: ${spec.scope.file}:${spec.scope.line}`,
    '',
    `Source code (lines ${ctx.lineStart}-${ctx.lineEnd}):`,
    ctx.snippet || '(source file could not be read)',
    '',
    'Output strict JSON only:',
    '{',
    '  "status": "pass"|"fail"|"inconclusive",',
    '  "verdictReason": "<one sentence; if pass, quote the proving line>",',
    '  "evidence": {',
    `    "file": "${spec.scope.file}",`,
    '    "line": <line number where the relevant behavior happens>,',
    '    "snippet": "<the specific code line(s) you base your verdict on>",',
    '    "expectedBehavior": "<from `then`>",',
    '    "actualBehavior": "<what the code actually does>"',
    '  }',
    '}',
    '',
    "Use 'inconclusive' only when the relevant code is genuinely not visible",
    '(e.g., the assertion targets a function declared elsewhere that is not in',
    'the shown window). Do not use inconclusive as a way to avoid judgement.',
  ].join('\n');
}

interface ParsedDecisionOk {
  ok: true;
  status: TestCaseStatus;
  verdictReason: string;
  evidence: {
    file?: string;
    line?: number;
    snippet?: string;
    expectedBehavior?: string;
    actualBehavior?: string;
  };
}

interface ParsedDecisionFail {
  ok: false;
  error: string;
}

/**
 * Robust JSON-from-LLM parser. Mirrors critic-client.ts:
 *   - strips <think>…</think> reasoning blocks
 *   - strips markdown fences
 *   - extracts the first outermost {…} if there's preamble
 *   - validates status enum
 */
function parseDecision(
  rawText: string,
  logger: TrackLogger,
  specId: string,
): ParsedDecisionOk | ParsedDecisionFail {
  let cleaned = rawText ?? '';
  const hadThink = /<think>[\s\S]*?<\/think>/.test(cleaned);
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (hadThink) {
    logBranch(logger, 'agent.test-run.case.parse-decision', {
      decision: 'stripped-think-block',
      specId,
      reasoning: 'reasoning-model emitted <think>...</think>',
    });
  }
  const hadFence = /^```/.test(cleaned);
  cleaned = cleaned.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  if (hadFence) {
    logBranch(logger, 'agent.test-run.case.parse-decision', {
      decision: 'stripped-markdown-fence',
      specId,
      reasoning: 'model wrapped JSON in markdown fence',
    });
  }
  if (!cleaned.startsWith('{')) {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      cleaned = m[0];
      logBranch(logger, 'agent.test-run.case.parse-decision', {
        decision: 'extracted-outer-json',
        specId,
      });
    } else {
      logBranch(logger, 'agent.test-run.case.parse-decision', {
        decision: 'parse-failure',
        specId,
        reasoning: 'no {…} block discovered',
      });
      return { ok: false, error: 'no JSON object in response' };
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    logCatch(logger, 'agent.test-run.case.parse-decision', e, {
      specId,
      contentPreview: cleaned.slice(0, 120),
    });
    return { ok: false, error: (e as Error).message };
  }

  const rec = parsed as {
    status?: unknown;
    verdictReason?: unknown;
    evidence?: Record<string, unknown>;
  };
  const status = rec.status;
  if (
    status !== 'pass' &&
    status !== 'fail' &&
    status !== 'inconclusive'
  ) {
    logBranch(logger, 'agent.test-run.case.parse-decision', {
      decision: 'parse-inconclusive',
      specId,
      reasoning: `status not in enum: ${String(status)}`,
    });
    return { ok: false, error: `status not in enum: ${String(status)}` };
  }
  logBranch(logger, 'agent.test-run.case.parse-decision', {
    decision: 'parse-complete',
    specId,
    status,
  });

  const verdictReason =
    typeof rec.verdictReason === 'string' ? rec.verdictReason.slice(0, 500) : '';
  const evRaw = rec.evidence ?? {};
  const evidence = {
    file: typeof evRaw.file === 'string' ? evRaw.file : undefined,
    line: typeof evRaw.line === 'number' ? evRaw.line : undefined,
    snippet: typeof evRaw.snippet === 'string' ? evRaw.snippet : undefined,
    expectedBehavior:
      typeof evRaw.expectedBehavior === 'string' ? evRaw.expectedBehavior : undefined,
    actualBehavior:
      typeof evRaw.actualBehavior === 'string' ? evRaw.actualBehavior : undefined,
  };
  return {
    ok: true,
    status: status as TestCaseStatus,
    verdictReason,
    evidence,
  };
}

function summarize(results: TestCaseResult[]): TestSummary {
  const summary: TestSummary = {
    total: results.length,
    pass: 0,
    fail: 0,
    inconclusive: 0,
    skipped: 0,
    byCategory: {},
  };
  for (const r of results) {
    summary[r.status]++;
    const cat = r.spec.category;
    if (!summary.byCategory[cat]) {
      summary.byCategory[cat] = { pass: 0, fail: 0, inconclusive: 0, skipped: 0 };
    }
    summary.byCategory[cat][r.status]++;
  }
  return summary;
}

// ── Default LLM caller (OpenAI-Chat-Completions, like critic-client) ────────

/**
 * Default LLM call path — speaks the same OpenAI-Chat-Completions dialect as
 * `critic-client.ts`. Returns the assistant's `content` verbatim; callers
 * are responsible for stripping reasoning/fences via parseDecision.
 */
const defaultLlmCaller: LlmCaller = async ({
  systemPrompt,
  userPrompt,
  criticConfig,
  apiKey,
  timeoutMs,
}) => {
  const baseUrl = criticConfig.baseUrl;
  if (!baseUrl) {
    throw new Error('criticConfig.baseUrl is required for default LLM caller');
  }
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';
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
  const env = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = env.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('response missing choices[0].message.content');
  }
  return { rawText: content, durationMs };
};
