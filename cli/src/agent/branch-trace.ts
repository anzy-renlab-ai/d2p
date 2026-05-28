/**
 * Phase 13.1 / 14D — branch-manifest.jsonl writer (full AST snapshot).
 *
 * Emits a line-oriented OpenTelemetry-shaped wide-event stream that IS the
 * proof of branch coverage DENOMINATOR. Each line is one `branch.evidence`
 * event, fully self-describing, with a sha256 hash chain so the file is
 * tamper-evident.
 *
 * The product property this unlocks:
 *
 *   cat .zerou/branch-manifest.jsonl | jq -r '.branch_id' | sort -u | wc -l
 *
 * == BranchCoverageReport.summary.branchesTotal. Anyone with `jq` + `sort`
 * + `wc` can verify the denominator without trusting any UI / report.
 *
 * Schema is locked — see docs/reviews/2026-05-27-log-as-proof-prior-art.md §6.
 *
 * Phase 14D — split from live stream (was branch-trace.jsonl).
 *
 *   - This module emits the FINAL canonical snapshot to
 *     `.zerou/branch-manifest.jsonl` — every AST branch, terminal verdict,
 *     hash chain rooted at ZERO. Atomic rename, idempotent on rerun.
 *     This file is the proof-of-coverage DENOMINATOR.
 *   - `BranchTraceStream` (branch-trace-stream.ts) emits incremental events
 *     DURING audit to a SEPARATE file `.zerou/branch-trace.jsonl`. Each
 *     event carries a live `state` field (evaluating / covered / retrying /
 *     mechanical-red / business-red). That file is the live event LOG and
 *     the coverage NUMERATOR (verdict ∉ {untested, unknown}).
 *   - Pre-14D consumers wrote both writers to the same file, and the
 *     terminal writer's atomic rename destroyed the live `state` history.
 *     Splitting the files fixes that data loss.
 *   - Both writers produce byte-identical events for the same BranchNode
 *     (canonical field order + sha256 over the no-hash form), so any
 *     consumer can verify a single line without knowing which writer
 *     produced it.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  BranchCoverageReport,
  BranchNode,
  BranchVerdict,
  FunctionCoverage,
} from './branch-coverage-types.js';

// ── Event shape ──────────────────────────────────────────────────────────────

/**
 * One line in branch-trace.jsonl. OTel-style wide event with audit envelope.
 *
 * Field-order matters for byte-identical output: stringification iterates
 * in insertion order, so building the object in canonical order produces
 * deterministic JSON.
 */
export interface BranchTraceEvent {
  // ── OpenTelemetry-style envelope ──────────────────────────────────────
  ts: string;
  trace_id: string;
  span_id?: string;
  event: 'branch.evidence';

  // ── Branch identity (the proof key) ───────────────────────────────────
  branch_id: string;
  branch_kind: string;
  branch_label: string;
  line_start: number;
  line_end: number;

  // ── Source position (OTel semconv) ────────────────────────────────────
  'code.function': string;
  'code.file.path': string;
  'code.line.number': number;
  'code.namespace'?: string;

  // ── Signal evidence ───────────────────────────────────────────────────
  signals: {
    ast: true;
    spec: boolean;
    judge: boolean;
    run: boolean | null;
  };
  verdict: BranchVerdict;
  evidence: {
    spec_ids: string[];
    judge_specs?: Array<{
      spec_id: string;
      status: string;
      snippet_preview: string;
    }>;
    runtime_hits?: number;
  };

  // ── Audit envelope ────────────────────────────────────────────────────
  seq: number;
  prev_hash: string;
  hash: string;
}

const ZERO_HASH = '0'.repeat(64);

// Crockford base32 alphabet — matches the ULID style used elsewhere in
// ZeroU. Used here only for shaping deterministic IDs derived from sha256
// digests; we don't need monotonicity or randomness for these IDs.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Write the branch-manifest.jsonl artifact (Phase 14D — renamed from
 * `writeBranchTrace`/`branch-trace.jsonl`).
 *
 * Same `report` → byte-identical file output (modulo the optional archived
 * copy, which uses an independent hash chain rooted at the same seed).
 *
 * @param cwd  the audited project root
 * @param report the cross-referenced branch coverage report
 * @param runTs optional run timestamp; when supplied an archived copy is
 *   written under `<cwd>/.zerou/runs/<runTs>/branch-manifest.jsonl`
 * @returns absolute path of the stable copy
 */
export function writeBranchManifest(
  cwd: string,
  report: BranchCoverageReport,
  runTs?: string,
): string {
  const zerouDir = path.join(cwd, '.zerou');
  fs.mkdirSync(zerouDir, { recursive: true });

  const events = buildBranchTraceEvents(report);
  const body = events.map((e) => JSON.stringify(e)).join('\n');
  const fileBody = events.length > 0 ? `${body}\n` : '';

  const stable = path.join(zerouDir, 'branch-manifest.jsonl');
  const tmp = `${stable}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, fileBody, 'utf8');
  fs.renameSync(tmp, stable);

  if (runTs) {
    const archDir = path.join(zerouDir, 'runs', runTs);
    fs.mkdirSync(archDir, { recursive: true });
    fs.writeFileSync(path.join(archDir, 'branch-manifest.jsonl'), fileBody, 'utf8');
  }

  return stable;
}

/**
 * @deprecated Phase 14D — use {@link writeBranchManifest}. This alias remains
 * for any in-flight callers; it writes to the SAME `branch-manifest.jsonl` path.
 * Will be removed in a future phase.
 */
export const writeBranchTrace = writeBranchManifest;

/**
 * Build the full ordered event list from a coverage report. Pure — exported
 * so the writer's logic can be inspected without filesystem effects.
 */
export function buildBranchTraceEvents(
  report: BranchCoverageReport,
): BranchTraceEvent[] {
  const trace_id = deriveTraceId(report);
  const ts = report.generatedAt;

  // Stable ordering: files alphabetical, then declaration line, then
  // tree-order within each function.
  const fns = [...report.functions].sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.name < b.name ? -1 : 1;
  });

  const events: BranchTraceEvent[] = [];
  let seq = 1;
  let prev_hash = ZERO_HASH;

  for (const fn of fns) {
    const ordered = flattenBranchTreeStable(fn.root);
    for (const node of ordered) {
      const span_id = deriveSpanId(trace_id, fn, node);
      const event = formatBranchEvent({
        node,
        fn,
        trace_id,
        span_id,
        ts,
        seq,
        prev_hash,
      });
      events.push(event);
      prev_hash = event.hash;
      seq += 1;
    }
  }

  return events;
}

/**
 * Build a single `branch.evidence` event with hash computed in place.
 * Pure — exported for tests.
 *
 * The hash covers a canonical serialization of the event with the `hash`
 * field omitted, so consumers can verify by:
 *
 *   const { hash, ...rest } = JSON.parse(line);
 *   assert(hash === sha256(JSON.stringify(rest)));
 */
export function formatBranchEvent(args: {
  node: BranchNode;
  fn: FunctionCoverage;
  trace_id: string;
  span_id: string;
  ts: string;
  seq: number;
  prev_hash: string;
}): BranchTraceEvent {
  const { node, fn, trace_id, span_id, ts, seq, prev_hash } = args;

  const hasSpec = node.specMatches.length > 0;
  const hasJudge = node.judgeEvidence.length > 0;
  const hasRunData = node.runtimeCoverage.linesTotal > 0;
  const hasRun: boolean | null = hasRunData
    ? node.runtimeCoverage.linesCovered > 0 ||
      node.runtimeCoverage.branchHit === true
    : null;

  // Truncate to OTel-style attribute caps.
  const spec_ids = uniq(node.specMatches.map((m) => m.specId)).slice(0, 5);
  const evidence: BranchTraceEvent['evidence'] = { spec_ids };

  if (hasJudge) {
    evidence.judge_specs = node.judgeEvidence.slice(0, 3).map((j) => ({
      spec_id: j.specId,
      status: j.status,
      snippet_preview: previewSnippet(j.snippet),
    }));
  }

  if (hasRunData) {
    evidence.runtime_hits = node.runtimeCoverage.linesCovered;
  }

  const branch_id = makeBranchId(fn, node);

  // Build event WITHOUT hash first — canonical-order JSON of this object
  // is what gets sha256'd.
  const withoutHash: Omit<BranchTraceEvent, 'hash'> = {
    ts,
    trace_id,
    span_id,
    event: 'branch.evidence',

    branch_id,
    branch_kind: node.kind,
    branch_label: node.label,
    line_start: node.lineStart,
    line_end: node.lineEnd,

    'code.function': fn.name,
    'code.file.path': fn.file,
    'code.line.number': fn.line,

    signals: {
      ast: true,
      spec: hasSpec,
      judge: hasJudge,
      run: hasRun,
    },
    verdict: node.verdict,
    evidence,

    seq,
    prev_hash,
  };

  const hash = sha256(JSON.stringify(withoutHash));

  return { ...withoutHash, hash };
}

// ── Internals ────────────────────────────────────────────────────────────────

/**
 * Flatten a branch tree in a deterministic visit order: emit the node
 * itself, then each child (in BranchNode.children array order), recursing
 * depth-first.
 *
 * `entry` nodes are *included*: they are the function's entry branch and
 * count toward branchesTotal in the coverage summary, so they must appear
 * in the trace for `sort -u | wc -l` to match the denominator.
 */
function flattenBranchTreeStable(root: BranchNode): BranchNode[] {
  const out: BranchNode[] = [];
  const visit = (n: BranchNode): void => {
    out.push(n);
    for (const c of n.children) visit(c);
  };
  visit(root);
  return out;
}

/**
 * Build the proof-key `branch_id`. Format:
 *
 *   <file>:<fn>@<declLine>:<kind>-line<lineStart>-direction#<n>
 *
 * - <direction> derives from `kind`: 'true' / 'false' / 'case-X' / 'catch' /
 *   'entry' / etc. The kind-to-direction map is total.
 * - <n> = positional disambiguator pulled from BranchNode.id's existing
 *   numeric suffix (the collector already attaches a per-function counter
 *   to each non-entry node id). If the id has no numeric suffix (entry,
 *   pre-counter nodes), n = 0.
 *
 * Same input → same id, byte-stable across runs.
 */
export function makeBranchId(fn: FunctionCoverage, node: BranchNode): string {
  const direction = kindToDirection(node);
  const n = positionalSuffix(node.id);
  return `${fn.file}:${fn.name}@${fn.line}:${node.kind}-line${node.lineStart}-${direction}#${n}`;
}

function kindToDirection(node: BranchNode): string {
  switch (node.kind) {
    case 'entry': return 'entry';
    case 'if-true': return 'true';
    case 'if-false': return 'false';
    case 'switch-case': {
      // Pull the case index from BranchNode.id, which the collector
      // formats as `switch-<line>-case-<idx>-<counter>`.
      const m = /case-(\d+)/.exec(node.id);
      return m ? `case-${m[1]}` : 'case';
    }
    case 'switch-default': return 'default';
    case 'try-body': return 'body';
    case 'catch': return 'catch';
    case 'finally': return 'finally';
    case 'ternary-true': return 'true';
    case 'ternary-false': return 'false';
    case 'loop-body': return 'body';
    case 'short-circuit': return 'short';
    default: return 'unknown';
  }
}

function positionalSuffix(rawId: string): number {
  // BranchNode.id looks like 'if-9-true-3' / 'try-10-catch-2' / 'entry'.
  const m = /-(\d+)$/.exec(rawId);
  if (!m) return 0;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : 0;
}

/**
 * Derive a deterministic 26-char Crockford-base32 trace_id from the report.
 * Not a real ULID (no embedded clock guarantee), but ULID-shaped so it
 * sorts and reads identically. We choose determinism over freshness so
 * the file is byte-identical on rerun.
 */
function deriveTraceId(report: BranchCoverageReport): string {
  const seed = `${report.generatedAt}|${report.cwd}|${report.summary.branchesTotal}`;
  return crockfordFromHash(sha256(seed), 26);
}

function deriveSpanId(
  trace_id: string,
  fn: FunctionCoverage,
  node: BranchNode,
): string {
  const seed = `${trace_id}|${fn.file}|${fn.name}|${node.id}|${node.lineStart}`;
  return crockfordFromHash(sha256(seed), 16);
}

function crockfordFromHash(hexDigest: string, length: number): string {
  // Hex → bit stream → base32. 64 hex chars = 256 bits → 51 base32 chars
  // (more than enough for 26).
  let out = '';
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < hexDigest.length && out.length < length; i++) {
    const nibble = parseInt(hexDigest[i]!, 16);
    if (Number.isNaN(nibble)) continue;
    acc = (acc << 4) | nibble;
    bits += 4;
    while (bits >= 5 && out.length < length) {
      bits -= 5;
      out += CROCKFORD[(acc >>> bits) & 0x1f]!;
    }
  }
  while (out.length < length) out += '0';
  return out;
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function previewSnippet(snippet: string): string {
  const collapsed = snippet.replace(/\s+/g, ' ').trim();
  return collapsed.length > 80 ? collapsed.slice(0, 80) : collapsed;
}

function uniq<T>(arr: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<T>();
  for (const v of arr) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
