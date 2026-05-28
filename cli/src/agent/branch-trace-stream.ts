/**
 * Phase 14C — incremental branch-trace.jsonl writer (live mode).
 *
 * The Phase 13.1 writer (`branch-trace.ts`) emits all `branch.evidence`
 * events at the END of audit. This module exposes an `BranchTraceStream`
 * class that APPENDS events DURING audit so the SSE relay can push them
 * to the UI in real time:
 *
 *   - `state='evaluating'` fires before each LLM-judge call
 *   - `state='covered'|'mechanical-red'|'business-red'` fires after the
 *     verdict lands
 *   - `state='retrying'` fires from bug-patcher on each retry attempt
 *
 * Hash chain continuity: the stream resumes the chain from the tail of
 * any pre-existing branch-trace.jsonl, so events written incrementally
 * are indistinguishable from a final batch dump.
 *
 * Surface: `BranchTraceStream` (class) + `indexBranchesByLine` /
 * `findMatchingBranch` / `deriveStateFromVerdict` (helpers).
 *
 * Cross-platform: paths normalized to POSIX forward-slash for the index
 * key and event payloads; FS operations use `path.join`.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import type { TrackLogger } from '../log-types.js';
import { logBranch, logCatch } from '../log/branch.js';
import type {
  BranchCoverageReport,
  BranchNode,
  BranchVerdict,
  FunctionCoverage,
} from './branch-coverage-types.js';
import type { TestCaseStatus } from './types.js';
import { makeBranchId } from './branch-trace.js';

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Live state surfaced to the UI. Mirrors `ui/src/lib/branchState.ts`
 * `BranchState`. Backend now emits the same names; the UI's `deriveBranchState`
 * trusts `state` over its heuristic when this field is present.
 */
export type BranchState =
  | 'pending'
  | 'evaluating'
  | 'covered'
  | 'mechanical-red'
  | 'business-red'
  | 'retrying';

export type BranchCategory = 'mechanical' | 'business';

/**
 * Stream event = the existing BranchTraceEvent extended with the optional
 * live-mode fields (`state` / `category` / `retry` / `spec_id` / `reason`).
 * Field order is canonical (insertion order = JSON output order) so the hash
 * chain stays deterministic.
 */
export interface BranchTraceStreamEvent {
  ts: string;
  trace_id: string;
  span_id?: string;
  event: 'branch.evidence';

  branch_id: string;
  branch_kind: string;
  branch_label: string;
  line_start: number;
  line_end: number;

  'code.function': string;
  'code.file.path': string;
  'code.line.number': number;

  signals: {
    ast: true;
    spec: boolean;
    judge: boolean;
    run: boolean | null;
  };
  verdict: BranchVerdict | 'pending';
  /** Optional — live state for UI. Set by `emitTransition`. */
  state?: BranchState;
  /** Optional — present when state is one of the two red flavours. */
  category?: BranchCategory;
  /** Optional — present when state === 'retrying'. */
  retry?: { attempt: number; max: number };
  /** Optional — the spec that triggered this transition. */
  spec_id?: string;
  /** Optional — human-readable reason (final patcher verdicts). */
  reason?: string;

  evidence: {
    spec_ids: string[];
    judge_specs?: Array<{
      spec_id: string;
      status: string;
      snippet_preview: string;
    }>;
    runtime_hits?: number;
  };

  seq: number;
  prev_hash: string;
  hash: string;
}

/** Subset accepted by `append()` — caller can omit envelope fields. */
export type PartialBranchTraceEvent = Omit<
  Partial<BranchTraceStreamEvent>,
  'seq' | 'prev_hash' | 'hash'
> &
  Pick<
    BranchTraceStreamEvent,
    | 'branch_id'
    | 'branch_kind'
    | 'branch_label'
    | 'line_start'
    | 'line_end'
    | 'code.function'
    | 'code.file.path'
    | 'code.line.number'
  >;

export interface BranchTraceStreamOpts {
  cwd: string;
  runTs?: string;
  /** Default true — preserve any existing file and resume hash chain. */
  append?: boolean;
  logger: TrackLogger;
}

/** Pair returned by the line-range index. */
export interface FunctionAndNode {
  fn: FunctionCoverage;
  node: BranchNode;
}

// ── Internals ────────────────────────────────────────────────────────────────

const ZERO_HASH = '0'.repeat(64);
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function crockfordFromHash(hexDigest: string, length: number): string {
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

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

// ── BranchTraceStream ────────────────────────────────────────────────────────

export class BranchTraceStream {
  readonly cwd: string;
  readonly runTs?: string;
  readonly path: string;
  readonly archivePath: string | null;
  readonly logger: TrackLogger;

  private _opened = false;
  private _closed = false;
  private _seq = 0;
  private _prevHash = ZERO_HASH;
  private _traceId: string;
  private _count = 0;
  private _writeQueue: Promise<void> = Promise.resolve();
  private readonly _append: boolean;

  constructor(opts: BranchTraceStreamOpts) {
    this.cwd = opts.cwd;
    this.runTs = opts.runTs;
    this.logger = opts.logger;
    this._append = opts.append !== false;
    const zerouDir = path.join(this.cwd, '.zerou');
    this.path = path.join(zerouDir, 'branch-trace.jsonl');
    this.archivePath = opts.runTs
      ? path.join(zerouDir, 'runs', opts.runTs, 'branch-trace.jsonl')
      : null;
    // Trace id is derived deterministically from cwd + (optional) runTs so two
    // streams in the same run share an id. If runTs is missing we mix in a
    // session timestamp resolved at construction; that way two unrelated
    // `zerou audit` runs get distinct ids.
    const traceSeed = `${this.cwd}|${opts.runTs ?? new Date().toISOString().slice(0, 10)}`;
    this._traceId = crockfordFromHash(sha256(traceSeed), 26);
  }

  /** Total events appended this session. */
  get count(): number {
    return this._count;
  }

  /**
   * Open the stream. Creates `.zerou/` if missing. If a previous
   * branch-trace.jsonl exists and `append: true` (default), reads its tail
   * to resume the hash chain.
   */
  async open(): Promise<void> {
    if (this._opened) return;
    const zerouDir = path.dirname(this.path);
    await fsp.mkdir(zerouDir, { recursive: true });
    if (this.archivePath) {
      await fsp.mkdir(path.dirname(this.archivePath), { recursive: true });
    }

    if (this._append && fs.existsSync(this.path)) {
      const tail = await this._readTail();
      if (tail) {
        this._seq = tail.seq;
        this._prevHash = tail.hash;
        if (tail.trace_id) this._traceId = tail.trace_id;
        logBranch(this.logger, 'agent.branch-trace.stream.open', {
          decision: 'resume',
          seq: this._seq,
          path: this.path,
        });
      } else {
        logBranch(this.logger, 'agent.branch-trace.stream.open', {
          decision: 'resume-empty-file',
          path: this.path,
        });
      }
    } else {
      // Fresh file — start with seq=0 so next append uses seq=1.
      if (!this._append && fs.existsSync(this.path)) {
        await fsp.rm(this.path, { force: true });
      }
      logBranch(this.logger, 'agent.branch-trace.stream.open', {
        decision: 'fresh',
        path: this.path,
      });
    }
    this._opened = true;
  }

  /**
   * Append one event. Hash-chained, atomic per call. Internally serialized
   * so concurrent callers don't interleave hash chain links.
   */
  async append(event: PartialBranchTraceEvent): Promise<BranchTraceStreamEvent> {
    if (this._closed) throw new Error('BranchTraceStream is closed');
    if (!this._opened) {
      throw new Error('BranchTraceStream.open() must be called before append()');
    }
    // Serialize writes through a single promise chain — guarantees the
    // hash chain is sequential even if the caller awaits N appends in
    // parallel.
    const previous = this._writeQueue;
    let resolveTurn!: () => void;
    const turn = new Promise<void>((r) => {
      resolveTurn = r;
    });
    this._writeQueue = previous.then(() => turn);
    try {
      await previous;
      const built = this._buildEvent(event);
      const line = JSON.stringify(built) + '\n';
      await fsp.appendFile(this.path, line, 'utf8');
      if (this.archivePath) {
        await fsp.appendFile(this.archivePath, line, 'utf8');
      }
      this._seq = built.seq;
      this._prevHash = built.hash;
      this._count += 1;
      return built;
    } finally {
      resolveTurn();
    }
  }

  /**
   * Convenience: emit a `state` transition for a BranchNode without forcing
   * callers to assemble the full envelope. Fills in branch_id / OTel fields
   * / verdict (`pending` when no terminal state yet) / signals.
   */
  async emitTransition(
    fn: FunctionCoverage,
    node: BranchNode,
    state: BranchState,
    extra?: {
      retry?: { attempt: number; max: number };
      spec_id?: string;
      reason?: string;
    },
  ): Promise<BranchTraceStreamEvent> {
    const branch_id = makeBranchId(fn, node);
    const hasSpec = node.specMatches.length > 0;
    const hasJudge = node.judgeEvidence.length > 0;
    const hasRun = node.runtimeCoverage.linesTotal > 0
      ? node.runtimeCoverage.linesCovered > 0 ||
        node.runtimeCoverage.branchHit === true
      : null;

    let category: BranchCategory | undefined;
    if (state === 'mechanical-red') category = 'mechanical';
    else if (state === 'business-red') category = 'business';

    // Verdict: when state is a terminal verdict, reflect it; otherwise
    // 'pending'. UI's `deriveBranchState` prefers `state` over `verdict`
    // anyway so this is mostly for CLI consumers (jq pipelines).
    let verdict: BranchVerdict | 'pending';
    if (state === 'covered') verdict = 'covered';
    else if (state === 'mechanical-red' || state === 'business-red') {
      verdict = 'untested';
    } else verdict = 'pending';

    const partial: PartialBranchTraceEvent = {
      branch_id,
      branch_kind: node.kind,
      branch_label: node.label,
      line_start: node.lineStart,
      line_end: node.lineEnd,
      'code.function': fn.name,
      'code.file.path': toPosix(fn.file),
      'code.line.number': fn.line,
      signals: { ast: true, spec: hasSpec, judge: hasJudge, run: hasRun },
      verdict,
      state,
      category,
      retry: extra?.retry,
      spec_id: extra?.spec_id,
      reason: extra?.reason,
      evidence: {
        spec_ids: node.specMatches.slice(0, 5).map((m) => m.specId),
      },
    };
    return this.append(partial);
  }

  /**
   * Close the stream. Flushes pending appends and prevents future writes.
   */
  async close(): Promise<void> {
    if (this._closed) return;
    try {
      await this._writeQueue;
    } catch (e) {
      logCatch(this.logger, 'agent.branch-trace.stream.close', e, {
        path: this.path,
      });
    }
    this._closed = true;
    logBranch(this.logger, 'agent.branch-trace.stream.close', {
      decision: 'closed',
      count: this._count,
      path: this.path,
    });
  }

  /** Build the next BranchTraceStreamEvent in canonical field order. */
  private _buildEvent(input: PartialBranchTraceEvent): BranchTraceStreamEvent {
    const seq = this._seq + 1;
    const prev_hash = this._prevHash;
    const ts = input.ts ?? new Date().toISOString();
    const span_id =
      input.span_id ??
      crockfordFromHash(
        sha256(`${this._traceId}|${input.branch_id}|${seq}`),
        16,
      );

    // Canonical-order object (must match the existing writer's field
    // order for byte-identical interop). Optional fields appear only when
    // explicitly provided, so consumers see no stray keys.
    const withoutHash: Omit<BranchTraceStreamEvent, 'hash'> = {
      ts,
      trace_id: input.trace_id ?? this._traceId,
      span_id,
      event: 'branch.evidence',

      branch_id: input.branch_id,
      branch_kind: input.branch_kind,
      branch_label: input.branch_label,
      line_start: input.line_start,
      line_end: input.line_end,

      'code.function': input['code.function'],
      'code.file.path': toPosix(input['code.file.path']),
      'code.line.number': input['code.line.number'],

      signals: input.signals ?? {
        ast: true,
        spec: false,
        judge: false,
        run: null,
      },
      verdict: input.verdict ?? 'pending',
      ...(input.state ? { state: input.state } : {}),
      ...(input.category ? { category: input.category } : {}),
      ...(input.retry ? { retry: input.retry } : {}),
      ...(input.spec_id ? { spec_id: input.spec_id } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      evidence: input.evidence ?? { spec_ids: [] },

      seq,
      prev_hash,
    };
    const hash = sha256(JSON.stringify(withoutHash));
    return { ...withoutHash, hash };
  }

  /**
   * Read the last non-empty line of the file to extract seq + hash. Falls
   * back to null when the file is empty / malformed.
   */
  private async _readTail(): Promise<{
    seq: number;
    hash: string;
    trace_id?: string;
  } | null> {
    try {
      const text = await fsp.readFile(this.path, 'utf8');
      const lines = text.split('\n').filter((l) => l.length > 0);
      if (lines.length === 0) return null;
      const lastLine = lines[lines.length - 1]!;
      const parsed = JSON.parse(lastLine) as Record<string, unknown>;
      const seq = typeof parsed.seq === 'number' ? parsed.seq : 0;
      const hash =
        typeof parsed.hash === 'string' ? (parsed.hash as string) : ZERO_HASH;
      const trace_id =
        typeof parsed.trace_id === 'string' ? (parsed.trace_id as string) : undefined;
      return { seq, hash, trace_id };
    } catch (e) {
      logCatch(this.logger, 'agent.branch-trace.stream.read-tail', e, {
        path: this.path,
      });
      return null;
    }
  }
}

// ── Helpers: spec → branch matching ──────────────────────────────────────────

/**
 * Build a per-file index of branch nodes ordered by `lineStart`. The map key
 * is POSIX-normalized (forward slashes) so callers can pass either Windows
 * or POSIX paths.
 */
export function indexBranchesByLine(
  report: BranchCoverageReport,
): Map<string, FunctionAndNode[]> {
  const idx = new Map<string, FunctionAndNode[]>();
  for (const fn of report.functions) {
    const file = toPosix(fn.file);
    const list = idx.get(file) ?? [];
    const visit = (n: BranchNode): void => {
      list.push({ fn, node: n });
      for (const c of n.children) visit(c);
    };
    visit(fn.root);
    idx.set(file, list);
  }
  // Stable order by lineStart, breaking ties by narrower range first so
  // deeper nodes come AFTER their enclosing parent — handy for "find first
  // containing" lookups.
  for (const [, list] of idx) {
    list.sort((a, b) => {
      if (a.node.lineStart !== b.node.lineStart) {
        return a.node.lineStart - b.node.lineStart;
      }
      const widthA = a.node.lineEnd - a.node.lineStart;
      const widthB = b.node.lineEnd - b.node.lineStart;
      return widthA - widthB;
    });
  }
  return idx;
}

/**
 * Given a `file:line` from a spec scope, find the BranchNode whose
 * `[lineStart, lineEnd]` contains that line. Prefers the narrowest match
 * (deepest branch in the tree) when nested branches overlap.
 *
 * Returns null when no node contains the line.
 */
export function findMatchingBranch(
  index: Map<string, FunctionAndNode[]>,
  file: string,
  line: number,
): FunctionAndNode | null {
  const key = toPosix(file);
  // Direct match first.
  let candidates = index.get(key);
  if (!candidates) {
    // Try a suffix match — specs sometimes carry relative paths that
    // don't match the index key exactly (e.g. './src/x.ts' vs 'src/x.ts').
    const stripped = key.replace(/^\.?\//, '');
    candidates = index.get(stripped);
    if (!candidates) {
      // Last resort: scan keys for endswith match. O(N) but N is small
      // (functions per project), and only fires on a real path mismatch.
      for (const [k, list] of index) {
        if (k.endsWith(`/${stripped}`) || k === stripped) {
          candidates = list;
          break;
        }
      }
    }
  }
  if (!candidates || candidates.length === 0) return null;

  let best: FunctionAndNode | null = null;
  let bestWidth = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    if (line < c.node.lineStart || line > c.node.lineEnd) continue;
    const width = c.node.lineEnd - c.node.lineStart;
    if (width < bestWidth) {
      bestWidth = width;
      best = c;
    }
  }
  return best;
}

// ── Verdict → state mapper (server-side mirror of UI heuristic) ──────────────

/**
 * Decide the live `BranchState` for a finalized LLM-judge verdict.
 * Mirrors `ui/src/lib/branchState.ts` `classifyRedCategory` so server-emitted
 * states match what the UI would derive offline.
 *
 *   - status='pass' → 'covered'
 *   - status='fail'  → 'business-red' when branch label / kind looks like
 *     auth/role/owner/etc.; otherwise 'mechanical-red'
 *   - status='inconclusive' → null (caller should skip emit)
 *   - status='skipped' → null (caller should skip emit)
 */
export function deriveStateFromVerdict(
  status: TestCaseStatus,
  _verdictReason: string | undefined,
  branch: { node: { kind: string; label: string } } | null,
): BranchState | null {
  if (status === 'pass') return 'covered';
  if (status === 'inconclusive' || status === 'skipped') return null;
  // status === 'fail' → classify red category.
  const kind = (branch?.node.kind ?? '').toLowerCase();
  const label = (branch?.node.label ?? '').toLowerCase();

  // Business-red signals (auth / authz / tenancy) — check first.
  if (
    /\b(auth|role|owner|admin|user[_\s-]?id|tenant|password|token|session)\b/.test(
      label,
    )
  ) {
    return 'business-red';
  }
  // Catch / finally / try-body are typical mechanical fixes (silent catch).
  if (kind === 'catch' || kind === 'try-body' || kind === 'finally') {
    return 'mechanical-red';
  }
  if (
    /encodeuricomponent|escapexml|sanitize|null[\s-]?check|undefined[\s-]?check/i.test(
      label,
    )
  ) {
    return 'mechanical-red';
  }
  // Default: assume business-red (UI matches; conservative).
  return 'business-red';
}
