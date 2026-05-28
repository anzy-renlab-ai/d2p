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
import { fetchLlm } from './llm-fetch.js';
import { runConcurrent } from './concurrency.js';
import type { AuthShape } from './auth-detector.js';
import type {
  BranchTraceStream,
  FunctionAndNode,
} from './branch-trace-stream.js';
import { deriveStateFromVerdict } from './branch-trace-stream.js';

const DEFAULT_CONCURRENCY = 5;

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
  /**
   * Phase 11.3: project auth shape. When set, the judge's prompt mentions
   * the auth helper so "endpoint queries db without auth check" reasoning
   * doesn't treat one-helper-call-up gates as missing.
   */
  authShape?: AuthShape;
  /**
   * Phase 14C: live branch-trace stream. When set, the runner emits an
   * `evaluating` event before the LLM call and a terminal state event
   * after the verdict, so the UI can pulse / snap colours in real time.
   */
  branchTraceStream?: BranchTraceStream;
  /**
   * Phase 14C: spec → branch lookup. Supplied alongside `branchTraceStream`;
   * the runner uses it to resolve which BranchNode a spec targets. When
   * absent, transition events are skipped (no-op fallback).
   */
  branchLookup?: (file: string, line: number) => FunctionAndNode | null;
}

export interface TestBatchOptions
  extends Omit<TestRunOptions, 'spec'> {
  /**
   * Max concurrent LLM calls. Default 5 (Phase 11.1). Set to 1 for
   * deterministic test ordering.
   */
  concurrency?: number;
  /** Optional AbortSignal to short-circuit pending specs. */
  signal?: AbortSignal;
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
// Phase 20 — bug-hunting upgrade. We expand the adversarial framing from
// "check rule compliance" to "actively hunt for bugs". The judge must now
// consider three modes of failure (security/rule violation, logic bug,
// correctness gap) and explicitly walk through edge cases that the spec
// did not enumerate. This lifts BugsJS-style logic-bug recall without
// regressing security recall.
//
// evidence.line semantics mirror OpenTelemetry's `code.line.number`
// (semconv 1.33.0): the EXACT line of the operation the trace describes,
// never the wrapping declaration. Downstream graders match against this
// with ±20 line tolerance, so wide-line citations silently fail.
const SYSTEM_PROMPT =
  [
    'You are an adversarial code reviewer hunting for bugs. Your job is to find ANY reason the code FAILS the given test assertion.',
    '',
    'Three modes of failure you must consider:',
    '1. Security/rule violation: code has a known dangerous pattern (sql concat, missing auth, XSS sink, hard-coded secret).',
    '2. Logic bug: code does the wrong thing under some input (off-by-one, wrong operator, missing case, wrong type coercion).',
    '3. Correctness gap: code\'s documented behavior diverges from what the spec implies.',
    '',
    'Default verdict = fail. Pass only when:',
    '- You can quote the exact code lines that obviously satisfy the assertion',
    '- AND you\'ve considered at least 3 edge cases (null/undefined input, boundary values, error path) and verified the code handles them.',
    '',
    'For logic bugs specifically, look for:',
    '- `<=` where `<` is intended (or vice versa) near array index / loop bounds',
    '- `==` where `===` matters (especially `== null` / `== \'\'` distinctions)',
    '- `||` defaulting where `??` is correct (0 / false / empty-string edge cases)',
    '- Missing await, missing return, missing break',
    '- Off-by-one in indexing or loop bounds',
    '- Wrong sign or wrong direction in comparisons',
    '- Type-coercion surprises (`parseInt` without radix; `Number(\'\')` returns 0; `+x` on non-numeric)',
    '- `.find()` / `.match()` / `.exec()` returning undefined; code accesses `.property` without check',
    '- Switch falling through without `break`',
    '- Async errors swallowed by try/catch that returns a default',
    '',
    'When citing evidence.line, name the EXACT line where the bug MANIFESTS (the dangerous call, the unsafe assignment, the buggy operator) — NOT the wrapping `function`, `if`, `try`, or `catch` line.',
    '',
    'Output JSON only — no markdown fence, no preamble.',
  ].join('\n');

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

  // ── 2.5. Phase 14C: live evaluating event ────────────────────────────────
  const matchedBranch =
    opts.branchLookup && opts.branchTraceStream
      ? opts.branchLookup(spec.scope.file, spec.scope.line)
      : null;
  if (opts.branchTraceStream && matchedBranch) {
    try {
      await opts.branchTraceStream.emitTransition(
        matchedBranch.fn,
        matchedBranch.node,
        'evaluating',
        { spec_id: spec.id },
      );
    } catch (err) {
      logCatch(logger, 'agent.test-run.case.stream-evaluating', err, {
        specId: spec.id,
      });
    }
  }

  // ── 3. Build prompt + call LLM ───────────────────────────────────────────
  const userPrompt = buildUserPrompt(spec, ctx, opts.authShape);
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

  // ── 5. Phase 14C: live terminal-state event ──────────────────────────────
  if (opts.branchTraceStream && matchedBranch) {
    const finalState = deriveStateFromVerdict(
      result.status,
      result.verdictReason,
      matchedBranch,
    );
    if (finalState) {
      try {
        await opts.branchTraceStream.emitTransition(
          matchedBranch.fn,
          matchedBranch.node,
          finalState,
          { spec_id: spec.id, reason: result.verdictReason },
        );
      } catch (err) {
        logCatch(logger, 'agent.test-run.case.stream-terminal', err, {
          specId: spec.id,
        });
      }
    }
  }

  return result;
}

// ── Batch runner ─────────────────────────────────────────────────────────────

/**
 * Run a batch of specs with bounded concurrency. Default N=5 (Phase 11.1).
 * Tests should pass `concurrency: 1` for deterministic ordering. Failures
 * inside `runTestCase` never throw — they surface as `inconclusive` results.
 */
export async function runTestCaseBatch(
  specs: TestCaseSpec[],
  ctx: TestBatchOptions,
): Promise<{ results: TestCaseResult[]; summary: TestSummary }> {
  const concurrency = ctx.concurrency ?? DEFAULT_CONCURRENCY;
  ctx.logger.log('info', 'agent.test-run.batch.start', {
    total: specs.length,
    hasCritic: !!(ctx.criticConfig && ctx.criticApiKey),
    concurrency,
  });

  const tasks = specs.map((spec) => () => runTestCase({ ...ctx, spec }));
  const settled = await runConcurrent(tasks, {
    maxInFlight: concurrency,
    logger: ctx.logger,
    branchPrefix: 'agent.test-run.batch',
    signal: ctx.signal,
  });

  const results: TestCaseResult[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i]!;
    if (s.ok && s.value) {
      results.push(s.value);
    } else {
      // runTestCase never throws; this branch only fires on AbortSignal.
      const spec = specs[i]!;
      results.push({
        spec,
        status: 'inconclusive',
        verdictReason: `batch task aborted: ${s.error?.message ?? 'unknown'}`,
        evidence: { file: spec.scope.file, line: spec.scope.line },
        criticFamily: ctx.criticConfig ? engineFamily(ctx.criticConfig) : null,
        durationMs: s.durationMs,
      });
    }
  }

  const summary = summarize(results);
  ctx.logger.log('info', 'agent.test-run.batch.complete', {
    total: summary.total,
    pass: summary.pass,
    fail: summary.fail,
    inconclusive: summary.inconclusive,
    skipped: summary.skipped,
    concurrency,
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

function buildUserPrompt(spec: TestCaseSpec, ctx: ContextWindow, authShape?: AuthShape): string {
  // Phase 9 Lite — information isolation. We deliberately do NOT include:
  //   - spec.id      (naming intent can leak generator's framing)
  //   - spec.category (priming the judge to look for a specific class of bug)
  //   - spec.reasoning (the generator's internal "why this test matters" — the
  //     judge must reach its own conclusion from the raw assertion + code)
  const lines: string[] = [
    'TASK: Hunt for bugs in the source code that would make it FAIL the assertion below.',
    'DEFAULT VERDICT: fail. Only return pass if you can quote the specific code',
    'line(s) that obviously satisfy the assertion AND you have walked at least',
    '3 edge cases without finding a divergence. Be skeptical.',
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
    'HUNT MODE:',
    'For each edge case below, predict what this code does. If any produces',
    'wrong output, that is a FAIL and `evidence.line` MUST be the line of the',
    'specific buggy operation (operator, call, assignment) — not the function',
    'declaration.',
    ' - Input is null',
    ' - Input is undefined',
    ' - Input is empty string \'\'',
    ' - Input is 0',
    ' - Input is negative',
    ' - Input has unicode / special chars',
    ' - Input is the boundary value (max/min the function should handle)',
    ' - Input causes the async/error path (rejected promise, thrown exception)',
    '',
    'When you can mentally execute the code on one of these inputs and the',
    'observable result violates `then`, that is sufficient evidence for `fail`.',
    'Quote the buggy expression in `evidence.snippet` and explain the divergence',
    'in `actualBehavior`.',
    '',
    'Output strict JSON only:',
    '{',
    '  "status": "pass"|"fail"|"inconclusive",',
    '  "verdictReason": "<one sentence; if pass, quote the proving line>",',
    '  "evidence": {',
    `    "file": "${spec.scope.file}",`,
    '    "line": <EXACT line number where the bug actually MANIFESTS — see rules below>,',
    '    "snippet": "<the specific code line(s) you base your verdict on>",',
    '    "expectedBehavior": "<from `then`>",',
    '    "actualBehavior": "<what the code actually does, including the edge-case input that triggers the bug>"',
    '  }',
    '}',
    '',
    'LINE PRECISION (downstream graders match against this with ±20 line tolerance):',
    ' - evidence.line MUST be the EXACT line where the dangerous OPERATION happens.',
    ' - For comparisons: line of the `==` / `===` / `<=` / `<` / `>=` / `>` operator.',
    ' - For type coercions: line of the `parseInt(` / `Number(` / `+x` / `String(` call.',
    ' - For missing awaits: line of the async CALL (the one that should have been awaited),',
    '   not the surrounding function declaration.',
    ' - For SQL/template-string injection: the line of the interpolated `${user}` inside',
    '   the query, not the line where the query string is declared.',
    ' - For XSS sinks (innerHTML, dangerouslySetInnerHTML, res.send, eval): the line of',
    '   the SINK call, not the line of the upstream variable.',
    ' - For missing auth/authz: the line of the unauthorized data access (`db.query(...)`,',
    '   `findUserById(...)`), not the line of the route export.',
    ' - For off-by-one / loop bounds: the line of the loop CONDITION or the index',
    '   expression — never the `for` keyword line if the bound is on a different line.',
    ' - For multi-line constructs, pick the LAST line that contributes to the bug.',
    ' - If the bug is the ABSENCE of a guard, cite the line of the first dangerous',
    '   operation that should have been guarded.',
    ' - NEVER cite the function declaration line, the `try` line, or the `import` line.',
    ' - If you cannot be specific to a line, return `inconclusive` not `fail`.',
    '',
    "Use 'inconclusive' only when the relevant code is genuinely not visible",
    '(e.g., the assertion targets a function declared elsewhere that is not in',
    'the shown window) OR you cannot localize a bug to a specific line. Do not',
    'use inconclusive as a way to avoid judgement.',
  ];
  // Phase 11.3: surface auth context so the judge stops marking
  // "endpoint queries DB without auth check" when the gate is one helper away.
  if (authShape && authShape.kind !== 'none') {
    const fnName = authShape.helperFunctionName ?? 'auth helper';
    const fromMod = authShape.helperImport ?? '(relative)';
    lines.push(
      '',
      `AUTH CONTEXT: this project uses ${authShape.kind}. The auth gate is`,
      `\`${fnName}\` from \`${fromMod}\`. If the visible window does NOT show`,
      `a call to ${fnName}() but the file imports it (or imports may be`,
      `omitted from the window), treat the auth check as POTENTIALLY PRESENT`,
      `at a helper one frame up — do NOT mark "auth missing" fail unless you`,
      `can quote both (a) absence of ${fnName}() in the window AND (b) absence`,
      `of any 401-returning early return. When in doubt prefer 'inconclusive'`,
      `with reason 'auth-context-may-be-upstream' over 'fail'.`,
    );
  }
  return lines.join('\n');
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
  const out = await fetchLlm({
    url,
    apiKey,
    model: criticConfig.modelId,
    systemPrompt,
    userPrompt,
    timeoutMs,
    branchPrefix: 'agent.test-run.case.llm-fetch',
  });
  if (!out.ok) {
    throw new Error(out.error);
  }
  return { rawText: out.rawText, durationMs: out.durationMs };
};
