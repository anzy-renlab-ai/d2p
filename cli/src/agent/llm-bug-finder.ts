/**
 * LLM-as-direct-detector (Phase 21).
 *
 * Goal: LLM-FIRST detection — read raw function source and infer bugs
 * WITHOUT any predefined rule / regex / preset. This unblocks the gap
 * on patterns regex can't express (cross-fn dataflow, semantic logic
 * errors, type-confusion bugs not shaped like existing rules).
 *
 * This module is OPT-IN via `--llm-detect`. Default off to control cost.
 *
 * Pipeline:
 *   1. Take FunctionInfo[] from ast-analyzer (analyzeFunctions()).
 *   2. For each function (cap=30 by default), call critic LLM with
 *      a system prompt instructing it to hunt for ANY bug, no checklist.
 *   3. Parse JSON output → InferredBug[].
 *   4. Validate enums / line bounds / required fields.
 *   5. Return concatenated InferredBug[] across functions.
 *
 * The audit pipeline wires this in after the preset scan and dedupes
 * `${file}:${line}:${bugType}` against existing findings before appending.
 *
 * Decision-branch log taxonomy:
 *   - agent.llm-detect.start
 *   - agent.llm-detect.fn.scan-start
 *   - agent.llm-detect.fn.bugs-found
 *   - agent.llm-detect.fn.scan-error
 *   - agent.llm-detect.fn.bug-dropped
 *   - agent.llm-detect.complete
 */
import type { TrackLogger } from '../log-types.js';
import type { EngineConfig, Finding } from '../stubs.js';
import { engineFamily } from '../stubs.js';
import { fetchLlm } from './llm-fetch.js';
import { runConcurrent } from './concurrency.js';
import { logBranch, logCatch } from '../log/branch.js';
import type { FunctionInfo } from './ast-analyzer.js';

// ── Public types ────────────────────────────────────────────────────────────

export type BugCategory =
  | 'logic'
  | 'security'
  | 'resource'
  | 'performance'
  | 'type-safety'
  | 'other';

export type BugSeverity = 'P1' | 'P2' | 'P3';
export type BugConfidence = 'high' | 'medium' | 'low';

export interface InferredBug {
  /** Function identifier (name@file:line). */
  fnId: string;
  /** Repo-relative POSIX file path. */
  file: string;
  /** 1-based exact line where the bug manifests (NOT the function decl). */
  line: number;
  bugType: BugCategory;
  severity: BugSeverity;
  /** Single-line summary ≤120 chars. */
  oneLineDesc: string;
  /** 2-3 sentences explaining why this is a bug. */
  rationale: string;
  /** Verbatim ~3 lines around the bug. */
  codeSnippet: string;
  confidence: BugConfidence;
}

export interface BugFinderLlmCallResult {
  rawText: string;
  durationMs: number;
}

export type BugFinderLlmFn = (args: {
  systemPrompt: string;
  userPrompt: string;
  criticConfig: EngineConfig;
  apiKey: string;
  timeoutMs: number;
}) => Promise<BugFinderLlmCallResult>;

export interface LlmBugFinderOpts {
  cwd: string;
  /** List of exported functions to scan (from ast-analyzer). */
  functions: FunctionInfo[];
  /** Required — this layer is LLM-only. */
  criticConfig: EngineConfig;
  criticApiKey: string;
  /** Max concurrent LLM calls. Default 5. */
  concurrency?: number;
  /** Per-fn LLM timeout. Default 45s. */
  timeoutMs?: number;
  /** Max fn count to process. Default 30. */
  maxFunctions?: number;
  logger: TrackLogger;
  /** Test seam — inject custom LLM caller. */
  callLLM?: BugFinderLlmFn;
  /** Optional AbortSignal to short-circuit pending tasks. */
  signal?: AbortSignal;
  /** Drop bugs below this confidence. Default 'medium' (keeps high+medium). */
  minConfidence?: BugConfidence;
  /** Cap bugs per function. Default 5. */
  maxBugsPerFunction?: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_FUNCTIONS = 30;
const DEFAULT_MAX_BUGS_PER_FN = 5;
const DEFAULT_MIN_CONFIDENCE: BugConfidence = 'medium';

const VALID_CATEGORIES: ReadonlySet<BugCategory> = new Set<BugCategory>([
  'logic',
  'security',
  'resource',
  'performance',
  'type-safety',
  'other',
]);

const VALID_SEVERITIES: ReadonlySet<BugSeverity> = new Set<BugSeverity>([
  'P1',
  'P2',
  'P3',
]);

const VALID_CONFIDENCES: ReadonlySet<BugConfidence> = new Set<BugConfidence>([
  'high',
  'medium',
  'low',
]);

// Mapping from internal category → short ruleId slug used in Finding.
const CATEGORY_RULE_SLUG: Record<BugCategory, string> = {
  logic: 'logic',
  security: 'security',
  resource: 'resource',
  performance: 'perf',
  'type-safety': 'type-safety',
  other: 'other',
};

const SYSTEM_PROMPT = [
  'You are a senior code reviewer hunting for ANY bug in the function below. You',
  'are NOT given a security checklist or rule list — your job is to read the code',
  'and identify real bugs your own way.',
  '',
  'Find bugs in these categories:',
  '- Logic: off-by-one, wrong comparison, missing case, wrong default',
  '- Security: injection, auth bypass, missing validation, secret leak',
  '- Resource: leak, race, unbounded loop',
  '- Performance: N+1, sync IO in handler, blocking call',
  '- Type safety: incorrect null check, unsafe cast, missing await',
  '- Correctness: doesn\'t do what its name implies',
  '',
  'Output strict JSON. Be specific and cite exact line numbers.',
  '',
  'Bias toward CONFIRMABLE bugs over speculation. If you can\'t quote the buggy',
  'line verbatim, don\'t report it. False positives reduce ZeroU\'s value to users.',
  '',
  'For each bug:',
  '- bugType: one of the 6 categories (logic | security | resource | performance | type-safety | other)',
  '- line: EXACT line where the bug manifests (not the function declaration)',
  '- severity: P1 = data corruption/exploit/crash; P2 = silently wrong; P3 = sloppy',
  '- confidence: high (sure), medium (probably), low (worth looking at)',
  '- oneLineDesc: ≤120 chars summary',
  '- rationale: 2-3 sentences why it\'s a bug',
  '- codeSnippet: the buggy line + 1 line context above/below',
  '',
  'Return an array. Empty array if no bugs. No markdown fence, no preamble.',
].join('\n');

// ── Public entry point ──────────────────────────────────────────────────────

/**
 * Run the LLM bug-finder over a list of functions. Never throws — per-fn
 * failures surface as `agent.llm-detect.fn.scan-error` and contribute zero
 * bugs to the batch.
 */
export async function findBugsViaLLM(opts: LlmBugFinderOpts): Promise<InferredBug[]> {
  const log = opts.logger;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxFunctions = opts.maxFunctions ?? DEFAULT_MAX_FUNCTIONS;
  const maxBugsPerFn = opts.maxBugsPerFunction ?? DEFAULT_MAX_BUGS_PER_FN;
  const minConfidence = opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const caller = opts.callLLM ?? defaultBugFinderLlmCaller;
  const start = Date.now();

  // Cap the function list.
  const fnList = opts.functions.slice(0, maxFunctions);

  log.log('info', 'agent.llm-detect.start', {
    fnCount: fnList.length,
    totalAvailable: opts.functions.length,
    concurrency,
    maxFunctions,
    timeoutMs,
  });

  if (fnList.length === 0) {
    log.log('info', 'agent.llm-detect.complete', {
      totalBugs: 0,
      byCategory: {},
      durationMs: Date.now() - start,
    });
    return [];
  }

  const tasks = fnList.map((fn) => () => scanOneFunction({
    fn,
    criticConfig: opts.criticConfig,
    criticApiKey: opts.criticApiKey,
    timeoutMs,
    caller,
    logger: log,
    maxBugs: maxBugsPerFn,
    minConfidence,
  }));

  const settled = await runConcurrent(tasks, {
    maxInFlight: concurrency,
    logger: log,
    branchPrefix: 'agent.llm-detect.batch',
    signal: opts.signal,
  });

  const allBugs: InferredBug[] = [];
  for (const r of settled) {
    if (r.ok && r.value) {
      allBugs.push(...r.value);
    }
    // failures already logged inside scanOneFunction
  }

  const byCategory: Record<string, number> = {};
  for (const b of allBugs) {
    byCategory[b.bugType] = (byCategory[b.bugType] ?? 0) + 1;
  }

  log.log('info', 'agent.llm-detect.complete', {
    totalBugs: allBugs.length,
    byCategory,
    durationMs: Date.now() - start,
    criticFamily: engineFamily(opts.criticConfig),
  });

  return allBugs;
}

// ── Per-function scan ───────────────────────────────────────────────────────

interface ScanOneOpts {
  fn: FunctionInfo;
  criticConfig: EngineConfig;
  criticApiKey: string;
  timeoutMs: number;
  caller: BugFinderLlmFn;
  logger: TrackLogger;
  maxBugs: number;
  minConfidence: BugConfidence;
}

async function scanOneFunction(opts: ScanOneOpts): Promise<InferredBug[]> {
  const { fn, logger } = opts;
  const fnId = `${fn.name}@${fn.file}:${fn.line}`;
  const { numberedSource, lineStart, lineEnd } = buildNumberedSource(fn);

  logger.log('info', 'agent.llm-detect.fn.scan-start', {
    fn: fnId,
    file: fn.file,
    line: fn.line,
    bytes: fn.sourceSnippet.length,
    lineStart,
    lineEnd,
  });

  const userPrompt = buildUserPrompt(fn, numberedSource, lineStart, lineEnd);

  let rawText: string;
  try {
    const out = await opts.caller({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      criticConfig: opts.criticConfig,
      apiKey: opts.criticApiKey,
      timeoutMs: opts.timeoutMs,
    });
    rawText = out.rawText;
  } catch (e) {
    logger.log('warn', 'agent.llm-detect.fn.scan-error', {
      fn: fnId,
      error: (e as Error).message?.slice(0, 200) ?? String(e),
    });
    return [];
  }

  const parsed = parseBugsFromRaw(rawText, logger, fnId);
  if (parsed === null) {
    return [];
  }

  // Validate + filter.
  const minRank = confidenceRank(opts.minConfidence);
  const bugs: InferredBug[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i];
    const validated = validateRawBug(raw, fn, fnId, lineStart, lineEnd, logger);
    if (!validated) continue;
    if (confidenceRank(validated.confidence) < minRank) {
      logBranch(logger, 'agent.llm-detect.fn.bug-dropped', {
        decision: 'low-confidence',
        fn: fnId,
        confidence: validated.confidence,
        bugType: validated.bugType,
      });
      continue;
    }
    bugs.push(validated);
    if (bugs.length >= opts.maxBugs) break;
  }

  logger.log('info', 'agent.llm-detect.fn.bugs-found', {
    fn: fnId,
    count: bugs.length,
    rawCount: parsed.length,
  });

  return bugs;
}

// ── Prompt building ─────────────────────────────────────────────────────────

interface NumberedSource {
  numberedSource: string;
  lineStart: number;
  lineEnd: number;
}

/**
 * Take the function snippet and add ±5 lines of buffer + line numbers
 * for the LLM. The fn.sourceSnippet already contains the body; we just
 * decorate.
 */
function buildNumberedSource(fn: FunctionInfo): NumberedSource {
  const snippetLines = fn.sourceSnippet.split(/\r?\n/);
  const lineStart = fn.line;
  const lineEnd = fn.line + snippetLines.length - 1;
  const numbered = snippetLines
    .map((l, i) => `${String(lineStart + i).padStart(5, ' ')}: ${l}`)
    .join('\n');
  return { numberedSource: numbered, lineStart, lineEnd };
}

function buildUserPrompt(
  fn: FunctionInfo,
  numberedSource: string,
  lineStart: number,
  lineEnd: number,
): string {
  return [
    `Function: ${fn.name}`,
    `File: ${fn.file}:${fn.line}`,
    `Lines: ${lineStart}-${lineEnd}`,
    `Branches: ${fn.branchCount}`,
    `Has async: ${fn.hasAsyncCall}`,
    '',
    'Source:',
    '```',
    numberedSource,
    '```',
    '',
    'Output JSON only (an array, no preamble, no fence):',
    '[',
    '  {"bugType":"logic","line":<n>,"severity":"P1","confidence":"high","oneLineDesc":"...","rationale":"...","codeSnippet":"..."},',
    '  ...',
    ']',
  ].join('\n');
}

// ── Parsing + validation ────────────────────────────────────────────────────

/**
 * Robust array-of-JSON parser. Strips <think>...</think>, markdown fences,
 * pulls out the first [...] block. Returns null on parse failure (and logs
 * a decision branch).
 */
export function parseBugsFromRaw(
  rawText: string,
  logger: TrackLogger,
  fnId: string,
): unknown[] | null {
  let cleaned = rawText ?? '';
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();

  if (!cleaned.startsWith('[')) {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (m) {
      cleaned = m[0];
    } else {
      // Maybe the LLM returned a single object — wrap it.
      const obj = cleaned.match(/\{[\s\S]*\}/);
      if (obj) {
        cleaned = `[${obj[0]}]`;
      } else {
        logBranch(logger, 'agent.llm-detect.fn.parse-decision', {
          decision: 'parse-failure',
          fn: fnId,
          reasoning: 'no [...] or {...} block discovered',
        });
        return null;
      }
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    logCatch(logger, 'agent.llm-detect.fn.parse-decision', e, {
      fn: fnId,
      preview: cleaned.slice(0, 120),
    });
    return null;
  }

  if (!Array.isArray(parsed)) {
    logBranch(logger, 'agent.llm-detect.fn.parse-decision', {
      decision: 'not-array',
      fn: fnId,
    });
    return null;
  }
  return parsed;
}

function validateRawBug(
  raw: unknown,
  fn: FunctionInfo,
  fnId: string,
  lineStart: number,
  lineEnd: number,
  logger: TrackLogger,
): InferredBug | null {
  if (!raw || typeof raw !== 'object') {
    logBranch(logger, 'agent.llm-detect.fn.bug-dropped', {
      decision: 'not-object',
      fn: fnId,
    });
    return null;
  }
  const rec = raw as Record<string, unknown>;
  const bugType = rec.bugType;
  if (typeof bugType !== 'string' || !VALID_CATEGORIES.has(bugType as BugCategory)) {
    logBranch(logger, 'agent.llm-detect.fn.bug-dropped', {
      decision: 'invalid-bugType',
      fn: fnId,
      bugType: String(bugType),
    });
    return null;
  }
  const severity = rec.severity;
  if (typeof severity !== 'string' || !VALID_SEVERITIES.has(severity as BugSeverity)) {
    logBranch(logger, 'agent.llm-detect.fn.bug-dropped', {
      decision: 'invalid-severity',
      fn: fnId,
      severity: String(severity),
    });
    return null;
  }
  const confidence = rec.confidence;
  if (
    typeof confidence !== 'string' ||
    !VALID_CONFIDENCES.has(confidence as BugConfidence)
  ) {
    logBranch(logger, 'agent.llm-detect.fn.bug-dropped', {
      decision: 'invalid-confidence',
      fn: fnId,
      confidence: String(confidence),
    });
    return null;
  }
  const line = rec.line;
  if (typeof line !== 'number' || !Number.isFinite(line) || line < 1) {
    logBranch(logger, 'agent.llm-detect.fn.bug-dropped', {
      decision: 'invalid-line',
      fn: fnId,
      line: String(line),
    });
    return null;
  }
  // Line must be within function body window. We allow ±2 lines of slop
  // since `fn.sourceSnippet` is capped at 200 lines and the LLM might
  // pick one off-by-one.
  if (line < lineStart - 2 || line > lineEnd + 2) {
    logBranch(logger, 'agent.llm-detect.fn.bug-dropped', {
      decision: 'line-out-of-range',
      fn: fnId,
      line,
      lineStart,
      lineEnd,
    });
    return null;
  }
  const oneLineDesc =
    typeof rec.oneLineDesc === 'string' ? rec.oneLineDesc.slice(0, 120) : '';
  const rationale =
    typeof rec.rationale === 'string' ? rec.rationale.slice(0, 1000) : '';
  const codeSnippet =
    typeof rec.codeSnippet === 'string' ? rec.codeSnippet.slice(0, 500) : '';
  if (!oneLineDesc) {
    logBranch(logger, 'agent.llm-detect.fn.bug-dropped', {
      decision: 'missing-oneLineDesc',
      fn: fnId,
    });
    return null;
  }
  return {
    fnId,
    file: fn.file,
    line: Math.floor(line),
    bugType: bugType as BugCategory,
    severity: severity as BugSeverity,
    oneLineDesc,
    rationale,
    codeSnippet,
    confidence: confidence as BugConfidence,
  };
}

function confidenceRank(c: BugConfidence): number {
  if (c === 'high') return 3;
  if (c === 'medium') return 2;
  return 1;
}

// ── Finding conversion ──────────────────────────────────────────────────────

/**
 * Convert an InferredBug into a Finding compatible with the existing audit
 * pipeline. Used by audit.ts to merge LLM-detected bugs with preset findings.
 */
export function inferredBugToFinding(bug: InferredBug, index: number): Finding {
  const presetId = `llm-detect-${bug.bugType}`;
  const ruleSlug = CATEGORY_RULE_SLUG[bug.bugType] ?? 'other';
  const ruleId = `llm-detect-${ruleSlug}`;
  return {
    id: `${presetId}.${ruleId}.${bug.file}:${bug.line}:${index}`,
    presetId,
    ruleId,
    severity: bug.severity,
    file: bug.file,
    line: bug.line,
    evidence: JSON.stringify({
      snippet: bug.codeSnippet,
      expectedBehavior: bug.oneLineDesc,
      actualBehavior: bug.rationale,
      confidence: bug.confidence,
    }),
    message: bug.oneLineDesc,
  };
}

// ── Default LLM caller (OpenAI-Chat-Completions, like critic-client) ────────

const defaultBugFinderLlmCaller: BugFinderLlmFn = async ({
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
    branchPrefix: 'agent.llm-detect.llm-fetch',
  });
  if (!out.ok) {
    throw new Error(out.error);
  }
  return { rawText: out.rawText, durationMs: out.durationMs };
};
