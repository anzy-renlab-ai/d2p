/**
 * Tests for `zerou coverage` (Phase 13.2).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

import { runCoverage, parseArgs } from './coverage.js';
import type {
  BranchCoverageReport,
  BranchNode,
  FunctionCoverage,
} from './agent/branch-coverage-types.js';

// ── fixture builders ──────────────────────────────────────────────────────

function leaf(id: string, verdict: BranchNode['verdict'] = 'untested'): BranchNode {
  return {
    id,
    label: id,
    lineStart: 1,
    lineEnd: 1,
    kind: 'if-true',
    children: [],
    ast: { present: true },
    specMatches: [],
    judgeEvidence: [],
    runtimeCoverage: { linesTotal: 1, linesCovered: 0, branchHit: null },
    verdict,
  };
}

function fnCov(file: string, name: string, line: number, branchIds: string[]): FunctionCoverage {
  const children = branchIds.map((id) => leaf(id));
  return {
    id: `${file}:${name}@${line}`,
    file,
    name,
    line,
    branchCount: branchIds.length,
    coveredCount: 0,
    selfDeceivingCount: 0,
    untestedCount: branchIds.length,
    root: {
      id: 'entry',
      label: name,
      lineStart: line,
      lineEnd: line + 20,
      kind: 'entry',
      children,
      ast: { present: true },
      specMatches: [],
      judgeEvidence: [],
      runtimeCoverage: { linesTotal: 1, linesCovered: 0, branchHit: null },
      verdict: 'unknown',
    },
    associatedSpecs: [],
  };
}

function report(functions: FunctionCoverage[]): BranchCoverageReport {
  // Count only leaf branches (skip 'entry'); same convention runCoverage uses.
  const branchesTotal = functions.reduce(
    (acc, f) => acc + countLeafBranches(f.root),
    0,
  );
  return {
    generatedAt: new Date().toISOString(),
    cwd: 'unused',
    functions,
    summary: {
      functionsAnalyzed: functions.length,
      branchesTotal,
      branchesCovered: 0,
      selfDeceivingTotal: 0,
      untestedTotal: branchesTotal,
      functionsWithSelfDeception: 0,
    },
    availability: { ast: true, spec: false, judge: false, runtime: false },
  };
}

function countLeafBranches(node: BranchNode): number {
  // Count nodes where kind !== 'entry'. Mirrors the canonical key filter
  // (which uses `file:fn@line:id`) — entry roots get the same key, but
  // the test fixture's branchesTotal must match what runCoverage iterates.
  // For simplicity here we count children only since fnCov puts leaves
  // under root.
  let n = node.kind === 'entry' ? 0 : 1;
  for (const c of node.children) n += countLeafBranches(c);
  return n;
}

// ── chain helpers for verify-chain tests ─────────────────────────────────

function canonicalize(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
  }
  return 'null';
}

function makeChainedJsonl(events: Array<Record<string, unknown>>): string {
  let prev = 'sha256:genesis';
  const lines: string[] = [];
  events.forEach((evt, i) => {
    const body = { ...evt, seq: i, prev_hash: prev };
    const canonical = canonicalize(body);
    const hash = 'sha256:' + crypto.createHash('sha256').update(prev + '\n' + canonical).digest('hex');
    const full = { ...body, hash };
    prev = hash;
    lines.push(JSON.stringify(full));
  });
  return lines.join('\n') + '\n';
}

// ── tmp-dir helper ────────────────────────────────────────────────────────

interface TmpFx {
  cwd: string;
  cleanup: () => Promise<void>;
  writeReport: (r: BranchCoverageReport, runId?: string) => void;
  writeTrace: (text: string, runId?: string) => void;
}

async function setup(): Promise<TmpFx> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zerou-cov-'));
  return {
    cwd: dir,
    cleanup: () => fsp.rm(dir, { recursive: true, force: true }).catch(() => {}),
    writeReport: (r, runId) => {
      const base = runId ? path.join(dir, '.zerou', 'runs', runId) : path.join(dir, '.zerou');
      fs.mkdirSync(base, { recursive: true });
      fs.writeFileSync(path.join(base, 'branch-coverage.json'), JSON.stringify(r, null, 2));
    },
    writeTrace: (text, runId) => {
      const base = runId ? path.join(dir, '.zerou', 'runs', runId) : path.join(dir, '.zerou');
      fs.mkdirSync(base, { recursive: true });
      fs.writeFileSync(path.join(base, 'branch-trace.jsonl'), text);
    },
  };
}

function traceJsonl(ids: Array<{ branch_id: string; verdict?: string }>): string {
  return ids.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

function runWith(cwd: string, extraArgs: string[]): {
  promise: Promise<number>;
  out: { value: string };
  err: { value: string };
} {
  const out = { value: '' };
  const err = { value: '' };
  const promise = runCoverage({
    argv: ['node', 'zerou', 'coverage', cwd, ...extraArgs],
    writeOut: (s) => {
      out.value += s;
    },
    writeErr: (s) => {
      err.value += s;
    },
  });
  return { promise, out, err };
}

// ── tests ─────────────────────────────────────────────────────────────────

describe('zerou coverage', () => {
  let fx: TmpFx;
  beforeEach(async () => {
    fx = await setup();
  });
  afterEach(async () => {
    await fx.cleanup();
  });

  it('1. exits 4 when branch-coverage.json is missing', async () => {
    // Trace exists but report missing — write trace only.
    fs.mkdirSync(path.join(fx.cwd, '.zerou'), { recursive: true });
    fs.writeFileSync(path.join(fx.cwd, '.zerou', 'branch-trace.jsonl'), '');
    const { promise, err } = runWith(fx.cwd, []);
    const code = await promise;
    expect(code).toBe(4);
    expect(err.value).toMatch(/missing.*branch-coverage\.json/);
  });

  it('2. exits 4 when branch-trace.jsonl is missing', async () => {
    fx.writeReport(report([fnCov('a.ts', 'f', 1, ['if-true'])]));
    const { promise, err } = runWith(fx.cwd, []);
    const code = await promise;
    expect(code).toBe(4);
    expect(err.value).toMatch(/missing.*branch-trace\.jsonl/);
  });

  it('3. empty trace + 0 branches → exits 0 (treats 0/0 as 100%)', async () => {
    fx.writeReport(report([]));
    fx.writeTrace('');
    const { promise, out } = runWith(fx.cwd, []);
    const code = await promise;
    expect(code).toBe(0);
    expect(out.value).toMatch(/0 \/ 0 \(100\.0%\)/);
  });

  it('4. 80 unique ids out of 100 branches → coverage_pct ≈ 80', async () => {
    // Build 100 branches across 5 functions of 20 each.
    const fns: FunctionCoverage[] = [];
    const allIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const ids = Array.from({ length: 20 }, (_, j) => `br-${i}-${j}`);
      fns.push(fnCov(`f${i}.ts`, `fn${i}`, 1, ids));
      for (const id of ids) allIds.push(`f${i}.ts:fn${i}@1:${id}`);
    }
    fx.writeReport(report(fns));
    // Witness first 80.
    fx.writeTrace(traceJsonl(allIds.slice(0, 80).map((id) => ({ branch_id: id }))));
    const { promise, out } = runWith(fx.cwd, ['--json']);
    const code = await promise;
    expect(code).toBe(0);
    const parsed = JSON.parse(out.value);
    expect(parsed.unique_seen).toBe(80);
    expect(parsed.total).toBe(100);
    expect(parsed.coverage_pct).toBe(80);
  });

  it('5. same branch_id repeated 3× counted once', async () => {
    fx.writeReport(report([fnCov('a.ts', 'f', 1, ['x', 'y'])]));
    fx.writeTrace(
      traceJsonl([
        { branch_id: 'a.ts:f@1:x' },
        { branch_id: 'a.ts:f@1:x' },
        { branch_id: 'a.ts:f@1:x' },
      ]),
    );
    const { promise, out } = runWith(fx.cwd, ['--json']);
    const code = await promise;
    expect(code).toBe(0);
    const parsed = JSON.parse(out.value);
    expect(parsed.unique_seen).toBe(1);
    expect(parsed.total).toBe(2);
    expect(parsed.coverage_pct).toBe(50);
  });

  it('6. --strict filters by verdict="covered"', async () => {
    fx.writeReport(report([fnCov('a.ts', 'f', 1, ['x', 'y', 'z'])]));
    fx.writeTrace(
      traceJsonl([
        { branch_id: 'a.ts:f@1:x', verdict: 'covered' },
        { branch_id: 'a.ts:f@1:y', verdict: 'judge-only' },
        { branch_id: 'a.ts:f@1:z', verdict: 'untested' },
      ]),
    );
    // Default mode (Phase 13.2 fix): untested + unknown are NOT counted as
    // "exercised" — only covered + judge-only + spec-only + run-only.
    const { promise: p1, out: out1 } = runWith(fx.cwd, ['--json']);
    expect(await p1).toBe(0);
    expect(JSON.parse(out1.value).unique_seen).toBe(2);

    const { promise: p2, out: out2 } = runWith(fx.cwd, ['--json', '--strict']);
    expect(await p2).toBe(0);
    const parsed2 = JSON.parse(out2.value);
    expect(parsed2.unique_seen).toBe(1);
    expect(parsed2.strict).toBe(true);
  });

  it('7. --threshold 80 + coverage 80 → exit 0', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `b${i}`);
    fx.writeReport(report([fnCov('a.ts', 'f', 1, ids)]));
    fx.writeTrace(
      traceJsonl(ids.slice(0, 8).map((id) => ({ branch_id: `a.ts:f@1:${id}` }))),
    );
    const { promise } = runWith(fx.cwd, ['--threshold', '80']);
    expect(await promise).toBe(0);
  });

  it('8. --threshold 80 + coverage 79.99 → exit 1', async () => {
    // 79 / 100 = 79
    const ids = Array.from({ length: 100 }, (_, i) => `b${i}`);
    fx.writeReport(report([fnCov('a.ts', 'f', 1, ids)]));
    fx.writeTrace(
      traceJsonl(ids.slice(0, 79).map((id) => ({ branch_id: `a.ts:f@1:${id}` }))),
    );
    const { promise, out } = runWith(fx.cwd, ['--threshold', '80']);
    const code = await promise;
    expect(code).toBe(1);
    expect(out.value).toMatch(/FAIL/);
  });

  it('9. --threshold 80 + coverage 80.5 → exit 0', async () => {
    // 161 / 200 = 80.5
    const ids = Array.from({ length: 200 }, (_, i) => `b${i}`);
    fx.writeReport(report([fnCov('a.ts', 'f', 1, ids)]));
    fx.writeTrace(
      traceJsonl(ids.slice(0, 161).map((id) => ({ branch_id: `a.ts:f@1:${id}` }))),
    );
    const { promise } = runWith(fx.cwd, ['--threshold', '80']);
    expect(await promise).toBe(0);
  });

  it('10. --json outputs valid parseable JSON', async () => {
    fx.writeReport(report([fnCov('a.ts', 'f', 1, ['x', 'y'])]));
    fx.writeTrace(traceJsonl([{ branch_id: 'a.ts:f@1:x' }]));
    const { promise, out } = runWith(fx.cwd, ['--json', '--threshold', '50']);
    expect(await promise).toBe(0);
    const parsed = JSON.parse(out.value);
    expect(parsed).toMatchObject({
      coverage_pct: 50,
      unique_seen: 1,
      total: 2,
      strict: false,
      threshold: 50,
      pass: true,
    });
    expect(Array.isArray(parsed.missing_branches)).toBe(true);
  });

  it('11. --verify-chain detects tampering → exit 5', async () => {
    fx.writeReport(report([fnCov('a.ts', 'f', 1, ['x', 'y'])]));
    const jsonl = makeChainedJsonl([
      { branch_id: 'a.ts:f@1:x' },
      { branch_id: 'a.ts:f@1:y' },
    ]);
    // Corrupt the second line's hash field.
    const lines = jsonl.trim().split('\n');
    const second = JSON.parse(lines[1]!);
    second.hash = 'sha256:deadbeef';
    lines[1] = JSON.stringify(second);
    fx.writeTrace(lines.join('\n') + '\n');
    const { promise, err } = runWith(fx.cwd, ['--verify-chain']);
    const code = await promise;
    expect(code).toBe(5);
    expect(err.value).toMatch(/chain.*broken/i);
  });

  it('12. --verify-chain passes intact file', async () => {
    fx.writeReport(report([fnCov('a.ts', 'f', 1, ['x', 'y'])]));
    const jsonl = makeChainedJsonl([
      { branch_id: 'a.ts:f@1:x' },
      { branch_id: 'a.ts:f@1:y' },
    ]);
    fx.writeTrace(jsonl);
    const { promise, out } = runWith(fx.cwd, ['--verify-chain', '--json']);
    const code = await promise;
    expect(code).toBe(0);
    const parsed = JSON.parse(out.value);
    expect(parsed.verify_chain).toMatchObject({ ok: true });
    expect(parsed.unique_seen).toBe(2);
  });

  it('13. --run <ts> resolves to archived path', async () => {
    const runId = '20260527-180000';
    fx.writeReport(report([fnCov('a.ts', 'f', 1, ['x'])]), runId);
    fx.writeTrace(traceJsonl([{ branch_id: 'a.ts:f@1:x' }]), runId);
    // also write a different report at the default path to ensure --run wins
    fx.writeReport(report([fnCov('z.ts', 'g', 1, ['a', 'b', 'c'])]));
    fx.writeTrace('');
    const { promise, out } = runWith(fx.cwd, ['--run', runId, '--json']);
    expect(await promise).toBe(0);
    const parsed = JSON.parse(out.value);
    expect(parsed.total).toBe(1);
    expect(parsed.unique_seen).toBe(1);
    expect(parsed.run).toBe(runId);
  });

  it('14. --by-function groups missing branches in human output', async () => {
    fx.writeReport(
      report([
        fnCov('a.ts', 'foo', 1, ['x', 'y', 'z']),
        fnCov('b.ts', 'bar', 1, ['p', 'q']),
      ]),
    );
    // Witness only one branch — leaves 4 missing across 2 functions.
    fx.writeTrace(traceJsonl([{ branch_id: 'a.ts:foo@1:x' }]));
    const { promise, out } = runWith(fx.cwd, ['--by-function']);
    expect(await promise).toBe(0);
    expect(out.value).toMatch(/grouped by function/);
    expect(out.value).toMatch(/a\.ts:foo/);
    expect(out.value).toMatch(/b\.ts:bar/);
  });

  it('15. cross-platform: path with native separators still finds artifacts', async () => {
    fx.writeReport(report([fnCov('a.ts', 'f', 1, ['x'])]));
    fx.writeTrace(traceJsonl([{ branch_id: 'a.ts:f@1:x' }]));
    // Use the native path verbatim (Windows backslash on win32).
    const native = fx.cwd.split('/').join(path.sep);
    const out = { value: '' };
    const code = await runCoverage({
      argv: ['node', 'zerou', 'coverage', native],
      writeOut: (s) => {
        out.value += s;
      },
      writeErr: () => undefined,
    });
    expect(code).toBe(0);
    expect(out.value).toMatch(/1 \/ 1/);
  });

  it('16. --help prints usage and exits 0', async () => {
    const out = { value: '' };
    const code = await runCoverage({
      argv: ['node', 'zerou', 'coverage', '--help'],
      writeOut: (s) => {
        out.value += s;
      },
      writeErr: () => undefined,
    });
    expect(code).toBe(0);
    expect(out.value).toMatch(/Usage: zerou coverage/);
  });

  it('17. invalid --threshold returns exit 2', async () => {
    const err = { value: '' };
    const code = await runCoverage({
      argv: ['node', 'zerou', 'coverage', fx.cwd, '--threshold', 'abc'],
      writeOut: () => undefined,
      writeErr: (s) => {
        err.value += s;
      },
    });
    expect(code).toBe(2);
    expect(err.value).toMatch(/--threshold must be/);
  });

  it('18. streams large trace file (10k lines) without OOM-style failure', async () => {
    const fnIds = Array.from({ length: 200 }, (_, i) => `b${i}`);
    fx.writeReport(report([fnCov('big.ts', 'huge', 1, fnIds)]));
    // 10k events, but only 200 unique branch_ids — exercises de-dup at scale.
    const lines: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      const idx = i % 200;
      lines.push(JSON.stringify({ branch_id: `big.ts:huge@1:b${idx}`, seq: i }));
    }
    fx.writeTrace(lines.join('\n') + '\n');
    const { promise, out } = runWith(fx.cwd, ['--json']);
    const code = await promise;
    expect(code).toBe(0);
    const parsed = JSON.parse(out.value);
    expect(parsed.unique_seen).toBe(200);
    expect(parsed.total).toBe(200);
    expect(parsed.coverage_pct).toBe(100);
  });

  it('19. malformed JSONL lines are skipped, valid lines still count', async () => {
    fx.writeReport(report([fnCov('a.ts', 'f', 1, ['x', 'y'])]));
    const text =
      JSON.stringify({ branch_id: 'a.ts:f@1:x' }) +
      '\n' +
      '{not valid json\n' +
      '\n' + // blank
      JSON.stringify({ branch_id: 'a.ts:f@1:y' }) +
      '\n';
    fx.writeTrace(text);
    const { promise, out } = runWith(fx.cwd, ['--json']);
    expect(await promise).toBe(0);
    const parsed = JSON.parse(out.value);
    expect(parsed.unique_seen).toBe(2);
  });
});

describe('parseArgs', () => {
  it('parses all flags', () => {
    const p = parseArgs([
      'demo/',
      '--threshold',
      '80',
      '--json',
      '--run',
      '20260101',
      '--strict',
      '--by-function',
      '--by-file',
      '--quiet',
      '--verify-chain',
    ]);
    expect(p.cwdArg).toBe('demo/');
    expect(p.threshold).toBe(80);
    expect(p.json).toBe(true);
    expect(p.runId).toBe('20260101');
    expect(p.strict).toBe(true);
    expect(p.byFunction).toBe(true);
    expect(p.byFile).toBe(true);
    expect(p.quiet).toBe(true);
    expect(p.verifyChain).toBe(true);
    expect(p.error).toBeUndefined();
  });

  it('rejects unknown flags', () => {
    const p = parseArgs(['--frobnicate']);
    expect(p.error).toMatch(/unknown option/);
  });

  it('rejects out-of-range threshold', () => {
    expect(parseArgs(['--threshold', '101']).error).toMatch(/--threshold/);
    expect(parseArgs(['--threshold', '-1']).error).toMatch(/--threshold/);
  });
});
