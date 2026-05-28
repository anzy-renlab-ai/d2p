/**
 * Phase 10 — Module C: bug-patcher.
 *
 * Authority:
 *   - docs/plans/2026-05-27-phase-10-enhance.md (Module C surface)
 *   - cli/src/enhance/types.ts (PatcherOpts / PatchResult / PatchLlmFn)
 *
 * Behaviour:
 *  1. Filter audit findings to P1/P2 severity and mechanical categories.
 *  2. For each eligible finding, read source window, call critic LLM for a
 *     unified diff, parse it, apply it, run `tsc --noEmit`, roll back on
 *     failure.
 *  3. Return a PatchResult[] (one per eligible finding; skipped findings are
 *     included with status='skipped').
 *
 * Safety rails:
 *  - cross-file diffs rejected ('cross-file-diff-rejected')
 *  - oversize diffs rejected ('oversize-diff', cap 4000 chars)
 *  - malformed diffs rejected ('patch-malformed')
 *  - context-mismatch rejected ('context-mismatch')
 *  - idempotency: if the source snippet already matches what the patch would
 *    produce (expectedBehavior substring), skip with 'already-patched'.
 *  - tsc failure triggers rollback ('tsc-failed: <first error>')
 *  - LLM throws → finding fails with reason 'llm-error: …', batch continues.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type {
  AuditFinding,
  PatchResult,
  PatcherOpts,
  PatchLlmFn,
} from './types.js';
import type { EngineConfig } from '../stubs.js';
import { logBranch, logCatch } from '../log/branch.js';
import type {
  BranchTraceStream,
  FunctionAndNode,
} from '../agent/branch-trace-stream.js';

const MAX_DIFF_LEN = 4000;
const CONTEXT_LINES = 20;
const DEFAULT_TIMEOUT_MS = 30_000;

// ── Category eligibility ────────────────────────────────────────────────────

type Eligibility =
  | { eligible: true; reason: string }
  | { eligible: false; reason: string };

const MECHANICAL_HINTS = [
  'encodeuricomponent',
  'escapexml',
  'sanitize',
  'sanitise',
];

function classifyFinding(f: AuditFinding): Eligibility {
  if (f.severity === 'P3') {
    return { eligible: false, reason: 'p3-not-included-in-v1' };
  }
  const cat = (f.category ?? '').toLowerCase();
  // ── Static-hardening categories (preset-based findings) ──────────────────
  switch (cat) {
    case 'secrets-leak':
      return { eligible: false, reason: 'secrets-not-auto-patched-v1' };
    case 'security-cors-csp':
      return { eligible: false, reason: 'env-dependent-skip-v1' };
    case 'auth-weakness':
      return { eligible: false, reason: 'too-risky-for-v1' };
    case 'db-injection':
      return { eligible: true, reason: 'mechanical-db-injection' };
    case 'error-handling':
      return { eligible: true, reason: 'mechanical-error-handling' };
    case 'observability-missing':
      return { eligible: true, reason: 'mechanical-observability' };
    default:
      break;
  }

  // ── Test-case-fail-derived categories (Phase 11.3) ───────────────────────
  // The judge marks specs as `fail` and we ingest them with category prefix
  // `test-case-fail-<original-category>`. Triage them per docs/reviews/2026-05-27.
  if (cat.startsWith('test-case-fail-')) {
    const orig = cat.slice('test-case-fail-'.length);
    switch (orig) {
      case 'security':
        return classifySecurityTestFail(f);
      case 'auth':
        return classifyAuthTestFail(f);
      case 'validation':
        return { eligible: true, reason: 'mechanical-validation-gap' };
      case 'error-handling':
        return { eligible: true, reason: 'mechanical-error-handling' };
      case 'edge-case':
        return classifyEdgeCaseTestFail(f);
      case 'happy-path':
        // A failing happy-path usually means real bug — defer to expected/actual hints.
        return classifyByHints(f, 'happy-path');
      default:
        return { eligible: false, reason: 'unknown-test-case-fail-category' };
    }
  }

  return classifyByHints(f, 'static');
}

/** Look at expected/actual/message text for mechanical hints. */
function classifyByHints(f: AuditFinding, contextTag: string): Eligibility {
  const text = `${f.expectedBehavior ?? ''} ${f.actualBehavior ?? ''} ${f.message ?? ''}`.toLowerCase();
  for (const hint of MECHANICAL_HINTS) {
    if (text.includes(hint)) {
      return { eligible: true, reason: `mechanical-hint:${hint}` };
    }
  }
  // Null/undefined-access bugs are mechanical (insert ?. or guard).
  if (/null|undefined|nullable|optional chain/.test(text)) {
    return { eligible: true, reason: 'mechanical-null-guard' };
  }
  // Unhandled rejection / stack-trace leak — wrap with try/catch.
  if (/unhandled|stack trace|leaked exception|rejection/.test(text)) {
    return { eligible: true, reason: 'mechanical-error-handling' };
  }
  return { eligible: false, reason: `not-mechanical-${contextTag}` };
}

/**
 * Security test-case fails are heterogeneous: IDOR / authz / race / unhandled
 * error / input validation. Triage by verdict text:
 *  - IDOR / authz / cross-tenant → reject ('authz-needs-row-predicate-v2')
 *  - race / TOCTOU / double-spend → reject ('concurrency-needs-tx-rewrite-v2')
 *  - input validation / sanitize → eligible (mechanical-validation-gap)
 *  - unhandled error / stack leak → eligible (mechanical-error-handling)
 *  - auth-context-missing (spec mal-specified) → reject
 *  - anything else → fall back to hint-based check
 */
function classifySecurityTestFail(f: AuditFinding): Eligibility {
  const text = `${f.expectedBehavior ?? ''} ${f.actualBehavior ?? ''} ${f.message ?? ''}`.toLowerCase();
  if (/idor|cross-tenant|other user|user b reads user a|wrong owner|tenant predicate/.test(text)) {
    return { eligible: false, reason: 'authz-needs-row-predicate-v2' };
  }
  if (/race|toctou|double[-\s]?spend|concurrent|duplicate write/.test(text)) {
    return { eligible: false, reason: 'concurrency-needs-tx-rewrite-v2' };
  }
  if (/auth-context-missing|spec mal-specified|spec mis-specified/.test(text)) {
    return { eligible: false, reason: 'spec-mal-specified' };
  }
  if (/validation|sanitize|sanitise|parseint|hex|injection|xss|encodeuri/.test(text)) {
    return { eligible: true, reason: 'mechanical-validation-gap' };
  }
  if (/unhandled|stack trace|leaked exception|rejection|missing try|missing catch/.test(text)) {
    return { eligible: true, reason: 'mechanical-error-handling' };
  }
  return classifyByHints(f, 'security-test-fail');
}

/**
 * Auth test-case fails — usually missing-auth-check on a read endpoint.
 * The patcher can insert `await getServerUser()` + guard IF an auth helper
 * exists in the project (auth-shape detection). For v1 we reject and let
 * the user wire it manually; the auth-fixture work makes future patches
 * possible.
 */
function classifyAuthTestFail(f: AuditFinding): Eligibility {
  const text = `${f.expectedBehavior ?? ''} ${f.actualBehavior ?? ''} ${f.message ?? ''}`.toLowerCase();
  if (/missing auth check|no authentication|without auth|unauthenticated/.test(text)) {
    return { eligible: false, reason: 'auth-needs-helper-context-v2' };
  }
  if (/session fixation|session hijack|cookie tampering|jwt forge/.test(text)) {
    return { eligible: false, reason: 'auth-design-rewrite-needed' };
  }
  return classifyByHints(f, 'auth-test-fail');
}

function classifyEdgeCaseTestFail(f: AuditFinding): Eligibility {
  const text = `${f.expectedBehavior ?? ''} ${f.actualBehavior ?? ''} ${f.message ?? ''}`.toLowerCase();
  if (/null|undefined/.test(text)) {
    return { eligible: true, reason: 'mechanical-null-guard' };
  }
  if (/overflow|integer|max safe|boundary/.test(text)) {
    return { eligible: false, reason: 'edge-case-needs-design-v2' };
  }
  return classifyByHints(f, 'edge-case-test-fail');
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Test seam — override the tsc self-check. Default impl runs `npx tsc`.
 * Tests can inject a fake to avoid spawning a real subprocess.
 */
export type TscRunner = (cwd: string) => { ok: true } | { ok: false; firstError: string };

export interface PatcherOptsInternal extends PatcherOpts {
  /** @internal — test-only seam for the tsc self-check. */
  runTscFn?: TscRunner;
  /**
   * Phase 14C: live branch-trace stream. When set, emits `retrying`
   * per attempt and a terminal `mechanical-red` / `covered` event after
   * success / final failure. v1 patcher is single-shot (no retry loop),
   * so callers will see one `retrying` (attempt:1/1) + one terminal event
   * per finding.
   */
  branchTraceStream?: BranchTraceStream;
  /** Phase 14C: finding → branch lookup. Same shape as the spec lookup. */
  branchLookup?: (file: string, line: number) => FunctionAndNode | null;
}

export async function patchBugs(opts: PatcherOptsInternal): Promise<PatchResult[]> {
  const { cwd, findings, criticConfig, criticApiKey, logger } = opts;
  const callLLM: PatchLlmFn = opts.callLLM ?? defaultLlmCaller;
  const tscFn: TscRunner = opts.runTscFn ?? runTsc;

  const triaged = findings.map((f) => ({ f, e: classifyFinding(f) }));
  const eligibleCount = triaged.filter((t) => t.e.eligible).length;

  logger.log?.('info', 'enhance.bug.patcher.start', {
    totalFindings: findings.length,
    eligible: eligibleCount,
  });

  const results: PatchResult[] = [];
  let applied = 0;
  let skipped = 0;
  let failed = 0;

  // Phase 14C: helper to emit a live transition without blowing up the
  // patcher on stream errors. Stream is best-effort.
  const emitState = async (
    f: AuditFinding,
    state: 'retrying' | 'mechanical-red' | 'covered' | 'business-red',
    extra?: { retry?: { attempt: number; max: number }; reason?: string },
  ): Promise<void> => {
    if (!opts.branchTraceStream || !opts.branchLookup) return;
    const branch = opts.branchLookup(f.file, f.line);
    if (!branch) return;
    try {
      await opts.branchTraceStream.emitTransition(branch.fn, branch.node, state, extra);
    } catch (err) {
      logCatch(logger, 'enhance.bug.patcher.stream', err, { findingId: f.id });
    }
  };

  for (const { f, e } of triaged) {
    if (!e.eligible) {
      logBranch(logger, 'enhance.bug.patcher.finding.skipped', {
        decision: 'skipped',
        reason: e.reason,
        findingId: f.id,
        category: f.category,
      });
      results.push({ finding: f, status: 'skipped', reason: e.reason });
      skipped++;
      continue;
    }
    // Live: patcher is starting work on this finding — show "retry 1/1".
    await emitState(f, 'retrying', { retry: { attempt: 1, max: 1 } });

    logger.log?.('info', 'enhance.bug.patcher.finding.start', {
      findingId: f.id,
      file: f.file,
      line: f.line,
    });

    // — Read source window
    const absFile = path.isAbsolute(f.file) ? f.file : path.resolve(cwd, f.file);
    let originalContent: string;
    try {
      originalContent = fs.readFileSync(absFile, 'utf8');
    } catch (err) {
      logCatch(logger, 'enhance.bug.patcher.finding.read-failed', err, {
        findingId: f.id,
        file: f.file,
      });
      results.push({
        finding: f,
        status: 'failed',
        reason: `read-failed: ${(err as Error).message}`.slice(0, 200),
      });
      failed++;
      logger.log?.('info', 'enhance.bug.patcher.finding.failed', {
        findingId: f.id,
        reason: 'read-failed',
      });
      continue;
    }

    // — Idempotency check: if expectedBehavior is already substring-present
    // around the finding line, skip.
    if (isAlreadyPatched(originalContent, f)) {
      logBranch(logger, 'enhance.bug.patcher.finding.skipped', {
        decision: 'skipped',
        reason: 'already-patched',
        findingId: f.id,
      });
      results.push({ finding: f, status: 'skipped', reason: 'already-patched' });
      skipped++;
      continue;
    }

    const ctx = buildContextWindow(originalContent, f.line, CONTEXT_LINES);

    // — No LLM? we can't do anything mechanical without a critic in v1.
    if (!criticConfig || !criticApiKey) {
      logBranch(logger, 'enhance.bug.patcher.finding.failed', {
        decision: 'failed',
        reason: 'no-critic-llm',
        findingId: f.id,
      });
      results.push({
        finding: f,
        status: 'failed',
        reason: 'no-critic-llm',
      });
      failed++;
      continue;
    }

    // — Call LLM
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(f, ctx);
    const llmStart = Date.now();
    let raw = '';
    try {
      const out = await callLLM({
        systemPrompt,
        userPrompt,
        cfg: criticConfig,
        apiKey: criticApiKey,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
      if (!out.ok) {
        throw new Error(out.error);
      }
      raw = out.rawText;
      logger.log?.('info', 'enhance.bug.patcher.finding.llm-call', {
        findingId: f.id,
        model: criticConfig.modelId,
        durationMs: Date.now() - llmStart,
        ok: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logCatch(logger, 'enhance.bug.patcher.finding.llm-call', err, {
        findingId: f.id,
        model: criticConfig.modelId,
        durationMs: Date.now() - llmStart,
      });
      results.push({
        finding: f,
        status: 'failed',
        reason: `llm-error: ${msg.slice(0, 200)}`,
      });
      failed++;
      logger.log?.('info', 'enhance.bug.patcher.finding.failed', {
        findingId: f.id,
        reason: 'llm-error',
      });
      continue;
    }

    // — Parse + validate diff
    const cleaned = cleanLlmText(raw, logger, f.id);
    if (cleaned.length > MAX_DIFF_LEN) {
      logBranch(logger, 'enhance.bug.patcher.finding.failed', {
        decision: 'failed',
        reason: 'oversize-diff',
        findingId: f.id,
        size: cleaned.length,
      });
      results.push({
        finding: f,
        status: 'failed',
        reason: `oversize-diff: ${cleaned.length} chars`,
      });
      failed++;
      continue;
    }

    const parsed = parseUnifiedDiff(cleaned);
    if (!parsed.ok) {
      logBranch(logger, 'enhance.bug.patcher.finding.failed', {
        decision: 'failed',
        reason: 'patch-malformed',
        findingId: f.id,
        detail: parsed.error,
      });
      results.push({
        finding: f,
        status: 'failed',
        reason: `patch-malformed: ${parsed.error}`,
      });
      failed++;
      continue;
    }

    logger.log?.('info', 'enhance.bug.patcher.finding.diff-parsed', {
      findingId: f.id,
      hunkCount: parsed.hunks.length,
    });

    // — Cross-file guard
    if (!sameFile(parsed.targetPath, f.file)) {
      logBranch(logger, 'enhance.bug.patcher.finding.failed', {
        decision: 'failed',
        reason: 'cross-file-diff-rejected',
        findingId: f.id,
        expectedFile: f.file,
        actualFile: parsed.targetPath,
      });
      results.push({
        finding: f,
        status: 'failed',
        reason: `cross-file-diff-rejected: diff targets ${parsed.targetPath}`,
      });
      failed++;
      continue;
    }

    // — Apply diff
    const applyRes = applyHunks(originalContent, parsed.hunks);
    if (!applyRes.ok) {
      logBranch(logger, 'enhance.bug.patcher.finding.failed', {
        decision: 'failed',
        reason: applyRes.error,
        findingId: f.id,
      });
      results.push({
        finding: f,
        status: 'failed',
        reason: applyRes.error,
      });
      failed++;
      continue;
    }

    fs.writeFileSync(absFile, applyRes.content, 'utf8');

    // — Run tsc self-check
    const tscRes = tscFn(cwd);
    if (!tscRes.ok) {
      // Rollback
      fs.writeFileSync(absFile, originalContent, 'utf8');
      logBranch(logger, 'enhance.bug.patcher.finding.failed', {
        decision: 'failed',
        reason: 'tsc-failed',
        findingId: f.id,
        firstError: tscRes.firstError.slice(0, 300),
      });
      results.push({
        finding: f,
        status: 'failed',
        reason: `tsc-failed: ${tscRes.firstError.slice(0, 300)}`,
        diff: cleaned,
      });
      failed++;
      continue;
    }

    logger.log?.('info', 'enhance.bug.patcher.finding.applied', {
      findingId: f.id,
      file: f.file,
    });
    results.push({
      finding: f,
      status: 'applied',
      diff: cleaned,
    });
    applied++;
  }

  // Phase 14C: emit terminal state per finding once the loop is over.
  // Patcher is single-shot in v1 (no retry loop), so this is the FINAL
  // state. `applied` → `covered` (patcher resolved the gap), `failed` /
  // `skipped` → `mechanical-red` (gap still there but patcher tried).
  for (const r of results) {
    if (r.status === 'applied') {
      await emitState(r.finding, 'covered', { reason: r.reason });
    } else if (r.status === 'failed') {
      await emitState(r.finding, 'mechanical-red', { reason: r.reason });
    }
    // 'skipped' findings don't get a terminal event — the eligibility
    // gate ran before any work, so the branch's state is unchanged from
    // whatever the prior audit emitted.
  }

  logger.log?.('info', 'enhance.bug.patcher.complete', {
    applied,
    skipped,
    failed,
  });
  return results;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

interface ContextWindow {
  snippet: string;
  lineStart: number;
  lineEnd: number;
}

function buildContextWindow(content: string, line: number, ctx: number): ContextWindow {
  const lines = content.split(/\r?\n/);
  const lineStart = Math.max(1, line - ctx);
  const lineEnd = Math.min(lines.length, line + ctx);
  const slice = lines.slice(lineStart - 1, lineEnd);
  const snippet = slice
    .map((l, i) => `${String(lineStart + i).padStart(4, ' ')}: ${l}`)
    .join('\n');
  return { snippet, lineStart, lineEnd };
}

function buildSystemPrompt(): string {
  return [
    'You are a senior engineer producing a SURGICAL fix for one specific bug.',
    'Output ONLY a unified diff. No prose. No markdown fence. No explanation.',
    'The diff MUST start with `--- a/<path>` and `+++ b/<path>` headers.',
    'Use ONE hunk if possible. Do NOT refactor unrelated code.',
    'Do NOT touch any file other than the target file.',
    'Preserve indentation EXACTLY as it appears in the original.',
  ].join('\n');
}

function buildUserPrompt(f: AuditFinding, ctx: ContextWindow): string {
  return [
    `TARGET FILE: ${f.file}`,
    `TARGET LINE: ${f.line}`,
    `SEVERITY: ${f.severity}`,
    `CATEGORY: ${f.category}`,
    `ISSUE: ${f.message}`,
    f.expectedBehavior ? `EXPECTED: ${f.expectedBehavior}` : '',
    f.actualBehavior ? `ACTUAL: ${f.actualBehavior}` : '',
    '',
    `Source code (lines ${ctx.lineStart}-${ctx.lineEnd}):`,
    ctx.snippet,
    '',
    'Output ONLY a unified diff fixing this finding. No prose.',
    `Diff headers MUST be:\n--- a/${f.file}\n+++ b/${f.file}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Strip `<think>` blocks + markdown fences. Mirrors test-spec-runner's parser. */
function cleanLlmText(rawText: string, logger: PatcherOpts['logger'], findingId: string): string {
  let cleaned = rawText ?? '';
  const hadThink = /<think>[\s\S]*?<\/think>/.test(cleaned);
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (hadThink) {
    logBranch(logger, 'enhance.bug.patcher.finding.clean', {
      decision: 'stripped-think-block',
      findingId,
    });
  }
  const hadFence = /^```/.test(cleaned);
  cleaned = cleaned.replace(/^```(?:diff|patch)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (hadFence) {
    logBranch(logger, 'enhance.bug.patcher.finding.clean', {
      decision: 'stripped-markdown-fence',
      findingId,
    });
  }
  return cleaned;
}

// ── Unified diff parser ─────────────────────────────────────────────────────

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[]; // raw lines starting with ' ', '+', '-', or '\\'
}

interface ParseOk {
  ok: true;
  targetPath: string; // value after `+++ b/`
  oldPath: string; // value after `--- a/`
  hunks: Hunk[];
}

interface ParseFail {
  ok: false;
  error: string;
}

export function parseUnifiedDiff(text: string): ParseOk | ParseFail {
  if (!text || !text.trim()) {
    return { ok: false, error: 'empty diff' };
  }
  const lines = text.split(/\r?\n/);
  let i = 0;
  // Skip leading blanks
  while (i < lines.length && lines[i]!.trim() === '') i++;

  // Allow optional `diff --git ...` / `index …` preambles.
  while (i < lines.length && !lines[i]!.startsWith('--- ')) {
    if (lines[i]!.startsWith('diff --git') || lines[i]!.startsWith('index ')) {
      i++;
      continue;
    }
    // Unexpected leading content
    return { ok: false, error: 'missing --- header' };
  }
  if (i >= lines.length || !lines[i]!.startsWith('--- ')) {
    return { ok: false, error: 'missing --- header' };
  }
  const oldPath = stripPathPrefix(lines[i]!.slice(4).trim());
  i++;
  if (i >= lines.length || !lines[i]!.startsWith('+++ ')) {
    return { ok: false, error: 'missing +++ header' };
  }
  const newPath = stripPathPrefix(lines[i]!.slice(4).trim());
  i++;

  const hunks: Hunk[] = [];
  while (i < lines.length) {
    if (lines[i]!.trim() === '') {
      i++;
      continue;
    }
    if (!lines[i]!.startsWith('@@')) {
      // Any other content between hunks is a malformation.
      return { ok: false, error: `unexpected line outside hunk: ${lines[i]!.slice(0, 40)}` };
    }
    const header = lines[i]!;
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
    if (!m) {
      return { ok: false, error: `bad hunk header: ${header.slice(0, 60)}` };
    }
    const oldStart = parseInt(m[1]!, 10);
    const oldCount = m[2] !== undefined ? parseInt(m[2]!, 10) : 1;
    const newStart = parseInt(m[3]!, 10);
    const newCount = m[4] !== undefined ? parseInt(m[4]!, 10) : 1;
    i++;

    const body: string[] = [];
    let consumedOld = 0;
    let consumedNew = 0;
    while (i < lines.length && !lines[i]!.startsWith('@@')) {
      const ln = lines[i]!;
      // Stop at next file boundary (multi-file diff — we reject below anyway)
      if (ln.startsWith('--- ') || ln.startsWith('+++ ') || ln.startsWith('diff --git')) {
        break;
      }
      if (ln === '') {
        // A truly empty line in a unified diff context line is technically
        // ' ' (space) — but many LLMs emit bare empty lines. Treat as context.
        body.push(' ');
        consumedOld++;
        consumedNew++;
        i++;
        continue;
      }
      const prefix = ln[0]!;
      if (prefix === ' ') {
        body.push(ln);
        consumedOld++;
        consumedNew++;
      } else if (prefix === '-') {
        body.push(ln);
        consumedOld++;
      } else if (prefix === '+') {
        body.push(ln);
        consumedNew++;
      } else if (prefix === '\\') {
        // "\ No newline at end of file" — ignore for counting.
        body.push(ln);
      } else {
        return { ok: false, error: `bad line prefix '${prefix}' in hunk` };
      }
      i++;
    }
    if (consumedOld !== oldCount) {
      return {
        ok: false,
        error: `hunk old count mismatch: header=${oldCount} body=${consumedOld}`,
      };
    }
    if (consumedNew !== newCount) {
      return {
        ok: false,
        error: `hunk new count mismatch: header=${newCount} body=${consumedNew}`,
      };
    }
    hunks.push({ oldStart, oldCount, newStart, newCount, lines: body });
  }
  if (hunks.length === 0) {
    return { ok: false, error: 'no @@ hunks found' };
  }
  // Reject multi-file diffs: if any other --- header appears in body we'd have
  // bailed already; but a stray second header at the very top is also rejected.
  // Cross-file check (oldPath vs newPath) — if oldPath !== newPath it's a
  // rename / cross-file diff which we don't support.
  return { ok: true, targetPath: newPath, oldPath, hunks };
}

function stripPathPrefix(p: string): string {
  // Strip leading a/ or b/, plus trailing tab+timestamp some tools emit.
  let s = p;
  const tab = s.indexOf('\t');
  if (tab !== -1) s = s.slice(0, tab);
  if (s.startsWith('a/') || s.startsWith('b/')) s = s.slice(2);
  return s.split('\\').join('/');
}

function sameFile(diffPath: string, findingFile: string): boolean {
  const a = diffPath.split('\\').join('/').replace(/^\.?\//, '');
  const b = findingFile.split('\\').join('/').replace(/^\.?\//, '');
  return a === b;
}

// ── Diff applier ────────────────────────────────────────────────────────────

interface ApplyOk {
  ok: true;
  content: string;
}
interface ApplyFail {
  ok: false;
  error: string;
}

export function applyHunks(original: string, hunks: Hunk[]): ApplyOk | ApplyFail {
  // Preserve original EOL style on a best-effort basis: if file has CRLF, keep
  // CRLF; otherwise LF.
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const origLines = original.split(/\r?\n/);
  // Walk hunks in order, applying with offset tracking.
  const out: string[] = [];
  let cursor = 0; // 0-based index into origLines next-to-copy
  // Sort hunks by oldStart to be defensive
  const sorted = [...hunks].sort((a, b) => a.oldStart - b.oldStart);
  for (const h of sorted) {
    const targetIdx = h.oldStart - 1; // 0-based
    if (targetIdx < cursor) {
      return { ok: false, error: 'context-mismatch: overlapping hunks' };
    }
    if (targetIdx > origLines.length) {
      return { ok: false, error: `context-mismatch: hunk targets line ${h.oldStart}, file has ${origLines.length}` };
    }
    // Copy unchanged region [cursor..targetIdx)
    for (let k = cursor; k < targetIdx; k++) {
      out.push(origLines[k]!);
    }
    cursor = targetIdx;
    // Apply hunk body
    for (const ln of h.lines) {
      if (ln.startsWith('\\')) continue; // "\ No newline" marker
      const prefix = ln[0]!;
      const rest = ln.slice(1);
      if (prefix === ' ') {
        const have = origLines[cursor];
        if (have === undefined || !contextMatches(have, rest)) {
          return {
            ok: false,
            error: `context-mismatch at line ${cursor + 1}: expected '${rest.slice(0, 60)}' got '${(have ?? '').slice(0, 60)}'`,
          };
        }
        out.push(have);
        cursor++;
      } else if (prefix === '-') {
        const have = origLines[cursor];
        if (have === undefined || !contextMatches(have, rest)) {
          return {
            ok: false,
            error: `context-mismatch at deletion line ${cursor + 1}: expected '${rest.slice(0, 60)}' got '${(have ?? '').slice(0, 60)}'`,
          };
        }
        cursor++;
      } else if (prefix === '+') {
        out.push(rest);
      }
    }
  }
  // Copy trailing region
  for (let k = cursor; k < origLines.length; k++) {
    out.push(origLines[k]!);
  }
  return { ok: true, content: out.join(eol) };
}

function contextMatches(have: string, want: string): boolean {
  // Strict equality first; allow trailing-whitespace tolerance (LLMs sometimes
  // trim trailing spaces from context lines).
  if (have === want) return true;
  if (have.replace(/\s+$/, '') === want.replace(/\s+$/, '')) return true;
  return false;
}

// ── Idempotency ─────────────────────────────────────────────────────────────

function isAlreadyPatched(content: string, f: AuditFinding): boolean {
  // Heuristic: if expectedBehavior names a specific helper (encodeURIComponent
  // / escapeXml / sanitize) AND that token already appears within the
  // surrounding window, we consider it patched.
  const expected = (f.expectedBehavior ?? '').toLowerCase();
  if (!expected) return false;
  const tokens: string[] = [];
  if (/encodeuricomponent/.test(expected)) tokens.push('encodeURIComponent');
  if (/escapexml/.test(expected)) tokens.push('escapeXml');
  if (/sanitize|sanitise/.test(expected)) tokens.push('sanitize');
  if (tokens.length === 0) return false;
  const lines = content.split(/\r?\n/);
  const start = Math.max(0, f.line - 1 - CONTEXT_LINES);
  const end = Math.min(lines.length, f.line - 1 + CONTEXT_LINES + 1);
  const windowText = lines.slice(start, end).join('\n');
  return tokens.some((t) => windowText.includes(t));
}

// ── tsc self-check ──────────────────────────────────────────────────────────

interface TscOk { ok: true; }
interface TscFail { ok: false; firstError: string; }

export function runTsc(cwd: string): TscOk | TscFail {
  const tsconfig = path.join(cwd, 'tsconfig.json');
  const hasTsconfig = fs.existsSync(tsconfig);
  const args = hasTsconfig
    ? ['--yes', 'tsc', '--noEmit', '-p', 'tsconfig.json']
    : ['--yes', 'tsc', '--noEmit'];
  const res = spawnSync('npx', args, {
    cwd,
    encoding: 'utf8',
    timeout: 180_000,
    shell: process.platform === 'win32',
  });
  if (res.status === 0) return { ok: true };
  const out = (res.stdout ?? '') + (res.stderr ?? '');
  const firstError = out.split(/\r?\n/).find((l) => /error/i.test(l)) ?? out.slice(0, 200);
  return { ok: false, firstError };
}

// ── Default LLM caller (OpenAI-Chat-Completions) ────────────────────────────

export const defaultLlmCaller: PatchLlmFn = async ({
  systemPrompt,
  userPrompt,
  cfg,
  apiKey,
  timeoutMs,
}) => {
  const baseUrl = cfg.baseUrl;
  if (!baseUrl) {
    return { ok: false, error: 'cfg.baseUrl is required' };
  }
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.modelId,
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
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const env = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
    const content = env.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      return { ok: false, error: 'response missing choices[0].message.content' };
    }
    return { ok: true, rawText: content };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

// Expose internal helpers for unit-testing (TS will tree-shake away from prod
// callers; we export under a namespace marker).
export const __test = {
  classifyFinding,
  parseUnifiedDiff,
  applyHunks,
  cleanLlmText,
  isAlreadyPatched,
};

// Silence unused-import warnings if EngineConfig is only referenced
// indirectly via PatcherOpts.
export type _EngineConfigRef = EngineConfig;
