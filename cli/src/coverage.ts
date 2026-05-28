/**
 * Phase 13.2 — `zerou coverage` CLI.
 *
 * Proves "X% of branches were exercised by ZeroU's generated tests" by
 * counting unique `branch_id`s in `.zerou/branch-trace.jsonl` (numerator,
 * written by Worker 13.1's instrumented run) and dividing by the AST-derived
 * `summary.branchesTotal` from `branch-coverage.json` (denominator).
 *
 * Spec: D:\lll\d2p\docs\reviews\2026-05-27-log-as-proof-prior-art.md
 *
 *   zerou coverage [<path>] [--threshold N] [--json] [--run <ts>]
 *                  [--strict] [--by-function] [--by-file] [--quiet]
 *                  [--verify-chain]
 *
 * Exit codes:
 *   0  ok / threshold met / no threshold
 *   1  coverage < threshold
 *   2  invalid CLI args / path does not exist
 *   4  missing required artifact (branch-coverage.json / branch-trace.jsonl)
 *   5  hash chain broken under --verify-chain
 *
 * Streams `branch-trace.jsonl` line-by-line via readline; never readFileSync
 * the whole jsonl.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import * as crypto from 'node:crypto';

import type {
  BranchCoverageReport,
  BranchVerdict,
  FunctionCoverage,
  BranchNode,
} from './agent/branch-coverage-types.js';

// ── Public types ──────────────────────────────────────────────────────────

/** One JSONL line emitted by Worker 13.1's branch-trace writer. */
export interface BranchTraceEvent {
  branch_id: string;
  /** 4-signal verdict (covered / judge-only / spec-only / run-only / untested / unknown). */
  verdict?: BranchVerdict | string;
  signals?: Record<string, unknown>;
  seq?: number;
  hash?: string;
  prev_hash?: string;
  // free-form; we only look at the above
  [k: string]: unknown;
}

export interface MissingBranchEntry {
  branch_id: string;
  verdict: BranchVerdict;
  file?: string;
  function?: string;
}

export interface CoverageJsonOutput {
  coverage_pct: number;
  unique_seen: number;
  total: number;
  missing_branches: MissingBranchEntry[];
  strict: boolean;
  threshold?: number;
  pass?: boolean;
  verify_chain?: { ok: boolean; last_good_seq?: number; reason?: string };
  run?: string;
}

export interface CoverageOpts {
  argv: string[];
  /** Test seam — capture stdout. */
  writeOut?: (s: string) => void;
  /** Test seam — capture stderr. */
  writeErr?: (s: string) => void;
}

// ── Argv parsing ──────────────────────────────────────────────────────────

interface ParsedArgs {
  cwdArg?: string;
  threshold?: number;
  json: boolean;
  runId?: string;
  strict: boolean;
  byFunction: boolean;
  byFile: boolean;
  quiet: boolean;
  verifyChain: boolean;
  help: boolean;
  /** Parser error message (causes exit 2). */
  error?: string;
}

export function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = {
    json: false,
    strict: false,
    byFunction: false,
    byFile: false,
    quiet: false,
    verifyChain: false,
    help: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--threshold') {
      const next = args[++i];
      const n = Number(next);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        out.error = `--threshold must be a number 0..100 (got: ${String(next)})`;
        return out;
      }
      out.threshold = n;
    } else if (a === '--json') {
      out.json = true;
    } else if (a === '--run') {
      const next = args[++i];
      if (!next) {
        out.error = '--run requires a value';
        return out;
      }
      out.runId = next;
    } else if (a === '--strict') {
      out.strict = true;
    } else if (a === '--by-function') {
      out.byFunction = true;
    } else if (a === '--by-file') {
      out.byFile = true;
    } else if (a === '--quiet') {
      out.quiet = true;
    } else if (a === '--verify-chain') {
      out.verifyChain = true;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    } else if (!a.startsWith('--') && !out.cwdArg) {
      out.cwdArg = a;
    } else if (a.startsWith('--')) {
      out.error = `unknown option: ${a}`;
      return out;
    }
  }
  return out;
}

function helpText(): string {
  return (
    'Usage: zerou coverage [<path>] [options]\n' +
    '\n' +
    'Compute branch-coverage from .zerou/branch-trace.jsonl, gated by\n' +
    'the AST-derived denominator in .zerou/branch-coverage.json.\n' +
    '\n' +
    'Options:\n' +
    '  --threshold N      Fail if coverage < N (0-100). Default: no gate.\n' +
    '  --json             Machine-readable JSON output.\n' +
    '  --run <ts>         Score archived run at .zerou/runs/<ts>/.\n' +
    '  --strict           Only count branches whose verdict == "covered".\n' +
    '  --by-function      Group human output by function.\n' +
    '  --by-file          Group human output by file.\n' +
    '  --quiet            Suppress stdout; exit code only.\n' +
    '  --verify-chain     Verify branch-trace.jsonl hash chain integrity.\n' +
    '  -h, --help         Show this help.\n' +
    '\n' +
    'Exit codes:\n' +
    '  0  ok / threshold met\n' +
    '  1  coverage < threshold\n' +
    '  2  invalid CLI args / path does not exist\n' +
    '  4  missing required artifact\n' +
    '  5  hash chain broken (with --verify-chain)\n'
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

interface ResolvedPaths {
  /** Directory containing branch-coverage.json + branch-{trace,manifest}.jsonl. */
  dir: string;
  reportPath: string;
  /** Live stream — numerator source (verdict ∉ {untested, unknown}). */
  tracePath: string;
  /**
   * Full AST snapshot — denominator source. Phase 14D split.
   * Backward compat: when manifest is absent but legacy trace exists, the
   * trace serves both roles (numerator + denominator).
   */
  manifestPath: string;
}

export function resolveArtifactPaths(cwd: string, runId?: string): ResolvedPaths {
  const zerouDir = path.join(cwd, '.zerou');
  const dir = runId ? path.join(zerouDir, 'runs', runId) : zerouDir;
  return {
    dir,
    reportPath: path.join(dir, 'branch-coverage.json'),
    tracePath: path.join(dir, 'branch-trace.jsonl'),
    manifestPath: path.join(dir, 'branch-manifest.jsonl'),
  };
}

/** Flatten a BranchNode tree into a list of (branch, owner-function). */
function flattenBranches(report: BranchCoverageReport): Map<string, { fn: FunctionCoverage; node: BranchNode }> {
  const out = new Map<string, { fn: FunctionCoverage; node: BranchNode }>();
  for (const fn of report.functions) {
    const stack: BranchNode[] = [fn.root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      // Construct the global branch_id key. The convention defined in the
      // log-as-proof spec is `file:fn@declLine:kind-line-direction#nthInScope`.
      // The AST already produces `node.id` per-function (e.g. 'if-line9-true').
      // We synthesize the global one as `${file}:${name}@${line}:${node.id}`.
      const key = `${fn.file}:${fn.name}@${fn.line}:${node.id}`;
      out.set(key, { fn, node });
      // Some emitters might also key by just node.id (legacy). Index those too,
      // so a trace event using either form de-dupes correctly.
      if (!out.has(node.id)) out.set(node.id, { fn, node });
      for (const child of node.children) stack.push(child);
    }
  }
  return out;
}

interface TraceStreamResult {
  /** Set of unique branch_ids that appeared (possibly filtered by --strict). */
  uniqueIds: Set<string>;
  /** Number of malformed lines silently skipped. */
  malformed: number;
  /** Verify-chain outcome, populated when verifyChain=true. */
  chain?: { ok: boolean; last_good_seq?: number; reason?: string };
}

/** SHA-256 helper for chain verification. */
function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * Canonical hash of a trace event's body (line minus its own `hash` field).
 * Worker 13.1's writer must use the same canonicalization.
 * Convention: stringify the event with sorted keys, omitting the `hash` field.
 * Returned format: `sha256:<hex>`.
 */
function canonicalHash(prevHash: string, event: BranchTraceEvent): string {
  const { hash: _omit, ...body } = event;
  void _omit;
  const sorted = canonicalize(body);
  return 'sha256:' + sha256(prevHash + '\n' + sorted);
}

function canonicalize(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) {
    return '[' + v.map(canonicalize).join(',') + ']';
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
  }
  return 'null';
}

/** Stream the JSONL file line-by-line, collecting unique branch_ids. */
async function streamTrace(args: {
  tracePath: string;
  strict: boolean;
  verifyChain: boolean;
}): Promise<TraceStreamResult> {
  const uniqueIds = new Set<string>();
  let malformed = 0;

  // Chain state — only used if verifyChain.
  let prevHash = 'sha256:genesis';
  let chainBroken: { last_good_seq?: number; reason: string } | null = null;
  let lastGoodSeq: number | undefined;

  const stream = fs.createReadStream(args.tracePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const raw of rl) {
    const line = raw.trim();
    if (line === '') continue;
    let evt: BranchTraceEvent;
    try {
      evt = JSON.parse(line) as BranchTraceEvent;
    } catch {
      malformed++;
      continue;
    }

    if (args.verifyChain && !chainBroken) {
      // Both fields required.
      if (typeof evt.hash !== 'string' || typeof evt.prev_hash !== 'string') {
        chainBroken = {
          last_good_seq: lastGoodSeq,
          reason: `seq ${String(evt.seq ?? '?')}: missing hash/prev_hash fields`,
        };
      } else if (evt.prev_hash !== prevHash) {
        chainBroken = {
          last_good_seq: lastGoodSeq,
          reason: `seq ${String(evt.seq ?? '?')}: prev_hash mismatch (expected ${prevHash}, got ${evt.prev_hash})`,
        };
      } else {
        const expected = canonicalHash(prevHash, evt);
        if (expected !== evt.hash) {
          chainBroken = {
            last_good_seq: lastGoodSeq,
            reason: `seq ${String(evt.seq ?? '?')}: hash mismatch`,
          };
        } else {
          prevHash = evt.hash;
          if (typeof evt.seq === 'number') lastGoodSeq = evt.seq;
        }
      }
    }

    if (typeof evt.branch_id !== 'string' || evt.branch_id.length === 0) {
      // Not a branch.taken event (could be span.start / span.end etc.).
      continue;
    }
    // Default mode: only count branches with REAL evidence (verdict ∉ {untested, unknown}).
    // Untested branches are emitted to the trace as a complete manifest, but should
    // NOT count toward "exercised" — that would let projects with 0 specs score 100%.
    // --strict: only verdict='covered' counts.
    if (args.strict) {
      if (evt.verdict !== 'covered') continue;
    } else {
      if (evt.verdict === 'untested' || evt.verdict === 'unknown') continue;
    }
    uniqueIds.add(evt.branch_id);
  }

  // Close the stream — readline will emit close once iteration ends, but
  // ensure descriptor is released for tests on Windows.
  stream.close();

  const result: TraceStreamResult = { uniqueIds, malformed };
  if (args.verifyChain) {
    if (chainBroken) {
      result.chain = { ok: false, last_good_seq: chainBroken.last_good_seq, reason: chainBroken.reason };
    } else {
      result.chain = { ok: true, last_good_seq: lastGoodSeq };
    }
  }
  return result;
}

// ── Output formatting ────────────────────────────────────────────────────

function formatHuman(args: {
  cwd: string;
  runId?: string;
  uniqueSeen: number;
  total: number;
  pct: number;
  threshold?: number;
  verdictCounts: Record<string, number>;
  missing: MissingBranchEntry[];
  byFunction: boolean;
  byFile: boolean;
  fnIndex: Map<string, FunctionCoverage>;
  strict: boolean;
  chain?: { ok: boolean; last_good_seq?: number; reason?: string };
}): string {
  const lines: string[] = [];
  const tag = args.runId ? `run ${args.runId}` : 'latest';
  const project = path.basename(args.cwd);
  lines.push(`zerou coverage · ${project} · ${tag}`);
  lines.push('─'.repeat(62));
  const pctStr = formatPct(args.pct);
  lines.push(`Branches exercised: ${args.uniqueSeen} / ${args.total} (${pctStr})`);
  // Sub-counts by verdict for the trace events we saw.
  const covered = args.verdictCounts['covered'] ?? 0;
  const judgeOnly = args.verdictCounts['judge-only'] ?? 0;
  const specOnly = args.verdictCounts['spec-only'] ?? 0;
  const runOnly = args.verdictCounts['run-only'] ?? 0;
  const untested = args.verdictCounts['untested'] ?? 0;
  lines.push(`  4-signal covered : ${covered}`);
  if (judgeOnly > 0) lines.push(`  judge-only       : ${judgeOnly}  ← self-deceiving`);
  if (specOnly > 0)  lines.push(`  spec-only        : ${specOnly}`);
  if (runOnly > 0)   lines.push(`  run-only         : ${runOnly}`);
  lines.push(`  untested         : ${untested}`);
  if (args.strict) lines.push(`  (--strict: counted only verdict='covered')`);

  if (args.byFile && args.missing.length > 0) {
    lines.push('');
    lines.push('Missing branches grouped by file (top 10):');
    const perFile = new Map<string, number>();
    for (const m of args.missing) {
      if (!m.file) continue;
      perFile.set(m.file, (perFile.get(m.file) ?? 0) + 1);
    }
    const top = [...perFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [file, n] of top) {
      lines.push(`  ${file}   ${n} branch${n === 1 ? '' : 'es'} uncovered`);
    }
  } else if (args.byFunction && args.missing.length > 0) {
    lines.push('');
    lines.push('Missing branches grouped by function (top 10):');
    const perFn = new Map<string, number>();
    for (const m of args.missing) {
      if (!m.function || !m.file) continue;
      const k = `${m.file}:${m.function}`;
      perFn.set(k, (perFn.get(k) ?? 0) + 1);
    }
    const top = [...perFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [k, n] of top) {
      lines.push(`  ${k}   ${n} branch${n === 1 ? '' : 'es'} uncovered`);
    }
  } else if (args.missing.length > 0) {
    lines.push('');
    lines.push('Missing branches (top 10):');
    for (const m of args.missing.slice(0, 10)) {
      lines.push(`  ${m.branch_id}`);
    }
  }

  if (args.chain) {
    lines.push('');
    if (args.chain.ok) {
      lines.push(`Chain: OK  (last seq ${args.chain.last_good_seq ?? 0})`);
    } else {
      lines.push(`Chain: BROKEN — ${args.chain.reason ?? 'unknown'}`);
      if (args.chain.last_good_seq !== undefined) {
        lines.push(`  last good seq: ${args.chain.last_good_seq}`);
      }
    }
  }

  if (args.threshold !== undefined) {
    lines.push('');
    const pass = args.pct >= args.threshold;
    lines.push(`Threshold: ${args.threshold}%  → ${pass ? 'PASS' : 'FAIL'} (${pctStr} ${pass ? '≥' : '<'} ${args.threshold})`);
  }

  return lines.join('\n') + '\n';
}

function formatPct(pct: number): string {
  if (!Number.isFinite(pct)) return '100.0%';
  return pct.toFixed(1) + '%';
}

// ── Main entry ───────────────────────────────────────────────────────────

export async function runCoverage(opts: CoverageOpts): Promise<number> {
  const writeOut = opts.writeOut ?? ((s: string) => process.stdout.write(s));
  const writeErr = opts.writeErr ?? ((s: string) => process.stderr.write(s));

  const parsed = parseArgs(opts.argv.slice(3));

  if (parsed.help) {
    writeOut(helpText());
    return 0;
  }
  if (parsed.error) {
    writeErr(`zerou coverage: ${parsed.error}\n`);
    return 2;
  }

  const cwd = path.resolve(parsed.cwdArg ?? process.cwd());
  if (!fs.existsSync(cwd)) {
    writeErr(`zerou coverage: path does not exist: ${cwd}\n`);
    return 2;
  }

  const { dir, reportPath, tracePath, manifestPath } = resolveArtifactPaths(cwd, parsed.runId);

  if (!fs.existsSync(reportPath)) {
    writeErr(
      `zerou coverage: missing ${reportPath}. ` +
        `Run \`zerou audit\` first (it writes branch-coverage.json).\n`,
    );
    return 4;
  }
  // Phase 14D — accept either branch-trace.jsonl (live stream) or
  // branch-manifest.jsonl (AST snapshot). Both files were a single
  // `branch-trace.jsonl` before 14D, so backward compat is automatic.
  if (!fs.existsSync(tracePath) && !fs.existsSync(manifestPath)) {
    writeErr(
      `zerou coverage: missing ${tracePath} (and ${manifestPath}). ` +
        `Run \`zerou audit\` with branch instrumentation enabled.\n`,
    );
    return 4;
  }

  // Load denominator.
  let report: BranchCoverageReport;
  try {
    const raw = fs.readFileSync(reportPath, 'utf8');
    report = JSON.parse(raw) as BranchCoverageReport;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeErr(`zerou coverage: could not read ${reportPath}: ${msg}\n`);
    return 4;
  }

  const total = report.summary?.branchesTotal ?? 0;
  const branchIndex = flattenBranches(report);

  // Phase 14D: numerator source precedence
  //   1. If branch-trace.jsonl exists (live stream), use it — gives `state`
  //      transitions AND verdicts, fresh per-run.
  //   2. Else if branch-manifest.jsonl exists, fall back to manifest (terminal
  //      verdicts). This covers the case where the live stream wasn't opened
  //      (e.g. no test specs generated) but manifest was still written.
  //   3. Else fall back to whichever exists (backward compat for pre-14D
  //      single-file layout).
  // The denominator comes from branch-coverage.json's branchesTotal — that
  // remains the AST source of truth.
  let numeratorSource: string;
  if (fs.existsSync(tracePath)) {
    numeratorSource = tracePath;
  } else if (fs.existsSync(manifestPath)) {
    numeratorSource = manifestPath;
  } else {
    numeratorSource = tracePath; // exists() check above already failed; preserve old error msg
  }

  let streamResult: TraceStreamResult;
  try {
    streamResult = await streamTrace({
      tracePath: numeratorSource,
      strict: parsed.strict,
      verifyChain: parsed.verifyChain,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeErr(`zerou coverage: error streaming ${numeratorSource}: ${msg}\n`);
    return 4;
  }

  // Hash-chain hard failure exits 5 unconditionally.
  if (parsed.verifyChain && streamResult.chain && !streamResult.chain.ok) {
    if (parsed.json) {
      const out: CoverageJsonOutput = {
        coverage_pct: 0,
        unique_seen: 0,
        total,
        missing_branches: [],
        strict: parsed.strict,
        verify_chain: streamResult.chain,
        ...(parsed.runId ? { run: parsed.runId } : {}),
      };
      writeOut(JSON.stringify(out, null, 2) + '\n');
    } else if (!parsed.quiet) {
      writeErr(
        `zerou coverage: hash chain broken — ${streamResult.chain.reason ?? 'unknown'}\n`,
      );
      if (streamResult.chain.last_good_seq !== undefined) {
        writeErr(`  last good seq: ${streamResult.chain.last_good_seq}\n`);
      }
    }
    return 5;
  }

  const uniqueSeen = streamResult.uniqueIds.size;

  // Coverage math. 0 / 0 → treat as 100% (no branches to cover, trivially full).
  const pct = total === 0 ? 100 : (uniqueSeen / total) * 100;

  // Bucket missing branches by verdict (from AST report, not from trace).
  // Skip `entry` nodes — they're function roots, not decision branches, and
  // are NOT included in `summary.branchesTotal`. Counting them here would
  // make the displayed verdict totals exceed the denominator.
  const missing: MissingBranchEntry[] = [];
  const verdictCounts: Record<string, number> = {};
  for (const [key, { fn, node }] of branchIndex) {
    // Only count canonical keys (the file:fn@line:id form) to avoid double-count
    // from the legacy node.id alias.
    if (!key.includes('@')) continue;
    if (node.kind === 'entry') continue;
    verdictCounts[node.verdict] = (verdictCounts[node.verdict] ?? 0) + 1;
    if (!streamResult.uniqueIds.has(key) && !streamResult.uniqueIds.has(node.id)) {
      missing.push({
        branch_id: key,
        verdict: node.verdict,
        file: fn.file,
        function: fn.name,
      });
    }
  }

  if (parsed.json) {
    const out: CoverageJsonOutput = {
      coverage_pct: Number(pct.toFixed(2)),
      unique_seen: uniqueSeen,
      total,
      missing_branches: missing.slice(0, 10),
      strict: parsed.strict,
      ...(parsed.threshold !== undefined
        ? { threshold: parsed.threshold, pass: pct >= parsed.threshold }
        : {}),
      ...(streamResult.chain ? { verify_chain: streamResult.chain } : {}),
      ...(parsed.runId ? { run: parsed.runId } : {}),
    };
    if (!parsed.quiet) writeOut(JSON.stringify(out, null, 2) + '\n');
  } else if (!parsed.quiet) {
    const text = formatHuman({
      cwd,
      runId: parsed.runId,
      uniqueSeen,
      total,
      pct,
      threshold: parsed.threshold,
      verdictCounts,
      missing,
      byFunction: parsed.byFunction,
      byFile: parsed.byFile,
      fnIndex: new Map(report.functions.map((f) => [f.id, f])),
      strict: parsed.strict,
      chain: streamResult.chain,
    });
    writeOut(text);
  }

  if (parsed.threshold !== undefined && pct < parsed.threshold) return 1;
  return 0;
}

// Suppress unused-helper lint when `dir` is computed but consumed only via paths.
void (null as unknown as ResolvedPaths['dir']);
