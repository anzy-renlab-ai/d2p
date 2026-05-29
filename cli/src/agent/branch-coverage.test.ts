/**
 * Tests for the branch-coverage collector (Phase 11.5).
 *
 * Covers:
 *  - AST tree shape (if / nested if / switch / try-catch-finally / ternary / empty fn)
 *  - Spec match heuristic (hit + miss)
 *  - Judge evidence line-range match (hit + miss)
 *  - Runtime coverage line hit map
 *  - Verdict matrix (covered / judge-only / spec-only / run-only / untested)
 *  - Runtime-unavailable downgrade
 *  - End-to-end smoke against a fake Next.js fixture
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import ts from 'typescript';

import {
  collectBranchCoverage,
  extractBranchesFromSource,
  loadTestResults,
  matchSpecTokens,
  writeBranchCoverage,
} from './branch-coverage.js';
import {
  createTrackLogger,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
  type TrackLogger,
} from '../log-types.js';

beforeEach(() => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
});

async function tmpdir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'zerou-bc-'));
}

async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content);
}

function makeLogger(cwd: string): TrackLogger {
  return createTrackLogger('agent', { logRoot: path.join(cwd, '.zerou', 'logs') });
}

/** Count all descendant nodes (excluding the root itself). */
function countDescendants(root: { children: Array<{ children: unknown[] }> }): number {
  let n = 0;
  for (const c of root.children) {
    n += 1 + countDescendants(c as { children: Array<{ children: unknown[] }> });
  }
  return n;
}

function parse(rel: string, source: string): ts.SourceFile {
  let kind: ts.ScriptKind = ts.ScriptKind.TS;
  if (rel.endsWith('.tsx')) kind = ts.ScriptKind.TSX;
  return ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, kind);
}

// ── AST extraction ─────────────────────────────────────────────────────────

describe('extractBranchesFromSource', () => {
  it('emits if-true + if-false for a simple if/else', () => {
    const src = `
export function f(x: number) {
  if (x > 0) {
    return 1;
  } else {
    return -1;
  }
}
`;
    const sf = parse('src/f.ts', src);
    const fns = extractBranchesFromSource(sf, 'src/f.ts', src, 50);
    expect(fns).toHaveLength(1);
    const fn = fns[0]!;
    expect(fn.root.kind).toBe('entry');
    expect(fn.root.children).toHaveLength(2);
    expect(fn.root.children[0]!.kind).toBe('if-true');
    expect(fn.root.children[1]!.kind).toBe('if-false');
  });

  it('emits nested if as children of if-true', () => {
    const src = `
export function f(x: number, y: number) {
  if (x > 0) {
    if (y > 0) {
      return 'a';
    }
    return 'b';
  }
  return 'c';
}
`;
    const sf = parse('src/f.ts', src);
    const fns = extractBranchesFromSource(sf, 'src/f.ts', src, 50);
    const fn = fns[0]!;
    const ifTrue = fn.root.children.find((c) => c.kind === 'if-true');
    expect(ifTrue).toBeTruthy();
    // Nested if should appear as a child of the outer if-true (it's inside its body).
    expect(ifTrue!.children.some((c) => c.kind === 'if-true')).toBe(true);
  });

  it('emits switch-case + switch-default nodes', () => {
    const src = `
export function f(x: number) {
  switch (x) {
    case 1: return 'a';
    case 2: return 'b';
    default: return 'z';
  }
}
`;
    const sf = parse('src/f.ts', src);
    const fns = extractBranchesFromSource(sf, 'src/f.ts', src, 50);
    const fn = fns[0]!;
    const kinds = fn.root.children.map((c) => c.kind);
    expect(kinds.filter((k) => k === 'switch-case')).toHaveLength(2);
    expect(kinds).toContain('switch-default');
  });

  it('emits try-body + catch + finally', () => {
    const src = `
export async function f() {
  try {
    await doStuff();
  } catch (err) {
    log(err);
  } finally {
    cleanup();
  }
}
`;
    const sf = parse('src/f.ts', src);
    const fns = extractBranchesFromSource(sf, 'src/f.ts', src, 50);
    const fn = fns[0]!;
    const kinds = fn.root.children.map((c) => c.kind);
    expect(kinds).toContain('try-body');
    expect(kinds).toContain('catch');
    expect(kinds).toContain('finally');
  });

  it('emits ternary-true + ternary-false', () => {
    const src = `
export function f(x: number) {
  return x > 0 ? 'pos' : 'neg';
}
`;
    const sf = parse('src/f.ts', src);
    const fns = extractBranchesFromSource(sf, 'src/f.ts', src, 50);
    const fn = fns[0]!;
    const kinds = fn.root.children.map((c) => c.kind);
    expect(kinds).toContain('ternary-true');
    expect(kinds).toContain('ternary-false');
  });

  it('empty function — root has only entry, no children', () => {
    const src = `
export function f() {
  return 42;
}
`;
    const sf = parse('src/f.ts', src);
    const fns = extractBranchesFromSource(sf, 'src/f.ts', src, 50);
    const fn = fns[0]!;
    expect(fn.root.kind).toBe('entry');
    expect(fn.root.children).toHaveLength(0);
  });

  it('skips non-exported functions', () => {
    const src = `
function privateFn() { if (true) return; }
export function publicFn() { return 1; }
`;
    const sf = parse('src/f.ts', src);
    const fns = extractBranchesFromSource(sf, 'src/f.ts', src, 50);
    expect(fns).toHaveLength(1);
    expect(fns[0]!.name).toBe('publicFn');
  });

  it('respects maxBranches cap', () => {
    const src = `
export function f(x: number) {
  if (x === 0) return 0;
  if (x === 1) return 1;
  if (x === 2) return 2;
  if (x === 3) return 3;
  if (x === 4) return 4;
  return -1;
}
`;
    const sf = parse('src/f.ts', src);
    const fns = extractBranchesFromSource(sf, 'src/f.ts', src, 2);
    const fn = fns[0]!;
    // root + ≤2 emitted branches.
    expect(fn.root.children.length).toBeLessThanOrEqual(2);
  });
});

// ── Token matching ─────────────────────────────────────────────────────────

describe('matchSpecTokens', () => {
  it('matches a 401 status code mentioned in code', () => {
    const matched = matchSpecTokens('returns 401', 'response.json({ status: 401 })');
    expect(matched).toContain('401');
  });

  it('matches a domain word', () => {
    const matched = matchSpecTokens('rejects invalid password', 'if (password !== stored) return 401');
    expect(matched).toContain('password');
  });

  it('does NOT match generic stopwords', () => {
    const matched = matchSpecTokens('the request returns a response', 'foo bar baz');
    // 'the', 'a', 'returns', 'response', 'request' all stopwords — should be empty.
    expect(matched).toEqual([]);
  });

  it('matches verbs like throws and reject', () => {
    // 'throws' and 'throw' are distinct tokens; the matcher only does literal
    // includes(). For this test we use a form where the verb stem matches.
    const matched = matchSpecTokens('throws ValidationError', 'if (x) throws new ValidationError()');
    expect(matched).toContain('throws');
    // Reject verb appears in both spec and haystack.
    const matched2 = matchSpecTokens('reject malformed input', 'if (malformed) reject(req)');
    expect(matched2).toContain('reject');
    expect(matched2).toContain('malformed');
  });
});

// ── loadTestResults ────────────────────────────────────────────────────────

describe('loadTestResults', () => {
  it('returns null for missing file', () => {
    const out = loadTestResults('/nonexistent/path/foo.json');
    expect(out).toBeNull();
  });

  it('returns null for malformed JSON', async () => {
    const dir = await tmpdir();
    const p = path.join(dir, 'bad.json');
    await fsp.writeFile(p, '{ this is not json');
    const out = loadTestResults(p);
    expect(out).toBeNull();
  });

  it('filters out entries without valid status', async () => {
    const dir = await tmpdir();
    const p = path.join(dir, 'good.json');
    await fsp.writeFile(p, JSON.stringify([
      { spec: { id: 'x' }, status: 'pass' },
      { spec: { id: 'y' }, status: 'BOGUS' },
      { spec: { id: 'z' }, status: 'fail' },
    ]));
    const out = loadTestResults(p);
    expect(out).toHaveLength(2);
  });
});

// ── End-to-end collector ──────────────────────────────────────────────────

describe('collectBranchCoverage (e2e)', () => {
  it('marks branch judge-only when spec + judge claim coverage but runtime shows 0 hits (self-deceiving)', async () => {
    const cwd = await tmpdir();
    const logger = makeLogger(cwd);

    await writeFile(cwd, 'app/api/login/route.ts', `
export async function POST(req: Request): Promise<Response> {
  const { email, password } = await req.json();
  if (!email) {
    return Response.json({ error: 'missing' }, { status: 400 });
  }
  if (password !== 'expected') {
    return Response.json({ error: 'bad creds' }, { status: 401 });
  }
  return Response.json({ token: 'ok' });
}
`);

    await writeFile(cwd, '.zerou/test-results.json', JSON.stringify([
      {
        spec: {
          id: 'login-1',
          name: 'rejects invalid password',
          category: 'auth',
          scope: { type: 'endpoint', target: 'POST /api/login', file: 'app/api/login/route.ts', line: 2 },
          given: 'wrong password',
          when: 'POST',
          then: 'returns 401 when password mismatch',
          reasoning: 'auth required',
        },
        // Judge PASSED — the self-deception is: judge claims this branch works,
        // but runtime coverage shows it was never executed (0 hits). That is
        // the genuine `judge-only` case. (A *failing* judge is NOT coverage and
        // must fall through to spec-only — covered by the dedicated test below.)
        status: 'pass',
        verdictReason: 'asserts 401 path',
        evidence: {
          file: 'app/api/login/route.ts',
          line: 8,
          snippet: 'return Response.json({ error: \'bad creds\' }, { status: 401 });',
          expectedBehavior: 'returns 401',
          actualBehavior: 'verified',
        },
        criticFamily: 'test',
        durationMs: 100,
      },
    ]));

    // Coverage data: line 8 area NOT hit (0 statements for password check).
    await writeFile(cwd, 'coverage/coverage-final.json', JSON.stringify({
      [path.join(cwd, 'app/api/login/route.ts').split(path.sep).join('/')]: {
        path: path.join(cwd, 'app/api/login/route.ts'),
        statementMap: {
          '0': { start: { line: 3, column: 0 }, end: { line: 3, column: 80 } },
        },
        s: { '0': 5 }, // line 3 hit, line 7-8 NOT in statementMap → 0 hits
        branchMap: {},
        b: {},
      },
    }));

    const report = await collectBranchCoverage({ cwd, logger });
    expect(report.functions.length).toBeGreaterThan(0);
    // Find the if-true at line ~7-9 (password mismatch).
    const fn = report.functions[0]!;
    const passwordBranch = fn.root.children.find(
      (c) => c.kind === 'if-true' && c.label.toLowerCase().includes('password'),
    );
    expect(passwordBranch).toBeTruthy();
    expect(passwordBranch!.specMatches.length).toBeGreaterThan(0);
    expect(passwordBranch!.judgeEvidence.length).toBeGreaterThan(0);
    expect(passwordBranch!.runtimeCoverage.linesCovered).toBe(0);
    expect(passwordBranch!.verdict).toBe('judge-only');
    expect(report.summary.selfDeceivingTotal).toBeGreaterThanOrEqual(1);
  });

  it('marks branch untested when no spec, no judge, no runtime hits', async () => {
    const cwd = await tmpdir();
    const logger = makeLogger(cwd);

    await writeFile(cwd, 'src/util.ts', `
export function f(x: number) {
  if (x < 0) {
    return 'neg';
  }
  return 'pos';
}
`);
    // No test-results, no coverage.
    const report = await collectBranchCoverage({ cwd, logger });
    const fn = report.functions.find((f) => f.name === 'f');
    expect(fn).toBeTruthy();
    const ifTrue = fn!.root.children.find((c) => c.kind === 'if-true');
    expect(ifTrue!.verdict).toBe('untested');
    expect(report.summary.untestedTotal).toBeGreaterThanOrEqual(1);
    expect(report.availability.runtime).toBe(false);
    expect(report.availability.spec).toBe(false);
  });

  it('marks branch run-only when coverage hits but no spec mentions it', async () => {
    const cwd = await tmpdir();
    const logger = makeLogger(cwd);

    await writeFile(cwd, 'src/util.ts', `
export function f(x: number) {
  if (x < 0) {
    return 'neg';
  }
  return 'pos';
}
`);
    // Hit lines 3-4 (if-true body) but provide ZERO specs.
    await writeFile(cwd, 'coverage/coverage-final.json', JSON.stringify({
      'src/util.ts': {
        path: 'src/util.ts',
        statementMap: {
          '0': { start: { line: 3, column: 0 }, end: { line: 4, column: 30 } },
        },
        s: { '0': 7 },
        branchMap: {},
        b: {},
      },
    }));

    const report = await collectBranchCoverage({ cwd, logger });
    expect(report.availability.runtime).toBe(true);
    const fn = report.functions.find((f) => f.name === 'f');
    expect(fn).toBeTruthy();
    const ifTrue = fn!.root.children.find((c) => c.kind === 'if-true');
    expect(ifTrue).toBeTruthy();
    expect(ifTrue!.runtimeCoverage.linesCovered).toBeGreaterThan(0);
    expect(ifTrue!.verdict).toBe('run-only');
  });

  it('marks branch covered when spec + judge + runtime all present', async () => {
    const cwd = await tmpdir();
    const logger = makeLogger(cwd);

    await writeFile(cwd, 'app/api/x/route.ts', `
export async function GET(): Promise<Response> {
  const v = compute();
  if (v < 0) {
    return Response.json({ error: 'neg' }, { status: 400 });
  }
  return Response.json({ v });
}
`);
    await writeFile(cwd, '.zerou/test-results.json', JSON.stringify([
      {
        spec: {
          id: 'x-1',
          name: 'rejects negative',
          category: 'validation',
          scope: { type: 'endpoint', target: 'GET /api/x', file: 'app/api/x/route.ts', line: 2 },
          given: 'neg value',
          when: 'GET',
          then: 'returns 400 negative',
          reasoning: 'reason',
        },
        status: 'pass',
        verdictReason: 'ok',
        evidence: {
          file: 'app/api/x/route.ts',
          line: 5,
          snippet: '{ status: 400 }',
        },
        criticFamily: 'test',
        durationMs: 50,
      },
    ]));
    await writeFile(cwd, 'coverage/coverage-final.json', JSON.stringify({
      'app/api/x/route.ts': {
        path: 'app/api/x/route.ts',
        statementMap: {
          '0': { start: { line: 5, column: 0 }, end: { line: 5, column: 80 } },
        },
        s: { '0': 3 },
        branchMap: {},
        b: {},
      },
    }));

    const report = await collectBranchCoverage({ cwd, logger });
    const fn = report.functions.find((f) => f.name === 'GET');
    expect(fn).toBeTruthy();
    const ifTrue = fn!.root.children.find((c) => c.kind === 'if-true');
    expect(ifTrue).toBeTruthy();
    expect(ifTrue!.specMatches.length).toBeGreaterThan(0);
    expect(ifTrue!.judgeEvidence.length).toBeGreaterThan(0);
    expect(ifTrue!.runtimeCoverage.linesCovered).toBeGreaterThan(0);
    expect(ifTrue!.verdict).toBe('covered');
  });

  it('downgrades verdict when runtime data is globally unavailable', async () => {
    const cwd = await tmpdir();
    const logger = makeLogger(cwd);
    await writeFile(cwd, 'app/api/y/route.ts', `
export async function GET(): Promise<Response> {
  if (Math.random() > 0.5) {
    return Response.json({ error: 'bad' }, { status: 500 });
  }
  return Response.json({});
}
`);
    await writeFile(cwd, '.zerou/test-results.json', JSON.stringify([
      {
        spec: {
          id: 'y-1',
          name: 'returns 500 on bad',
          category: 'error-handling',
          scope: { type: 'endpoint', target: 'GET /api/y', file: 'app/api/y/route.ts', line: 2 },
          given: 'random',
          when: 'GET',
          then: 'returns 500',
          reasoning: '',
        },
        status: 'fail',
        verdictReason: 'unknown',
        evidence: {
          file: 'app/api/y/route.ts',
          line: 4,
          snippet: 'status: 500',
        },
        criticFamily: 'test',
        durationMs: 10,
      },
    ]));
    // NO coverage-final.json.

    const report = await collectBranchCoverage({ cwd, logger });
    expect(report.availability.runtime).toBe(false);
    const fn = report.functions.find((f) => f.name === 'GET');
    expect(fn).toBeTruthy();
    // None of the branches should be 'covered' because runtime is missing.
    for (const node of [fn!.root, ...fn!.root.children]) {
      expect(node.verdict).not.toBe('covered');
    }
  });

  // Bug 1 (verdict): a FAILING judge must NOT count as coverage. With spec +
  // failing judge + runtime hit, the verdict must be the run/spec signal
  // (`covered` here would be wrong because the judge didn't pass — but spec+run
  // is legitimately `covered`). What we assert is that the *judge* signal is
  // ignored: the branch is NOT promoted by judge evidence. To isolate the judge
  // path we provide spec + failing judge but NO runtime hit → must be
  // `spec-only`, never `judge-only`.
  it('judge-fail does NOT count as covered/judge-only (Bug 1)', async () => {
    const cwd = await tmpdir();
    const logger = makeLogger(cwd);
    await writeFile(cwd, 'app/api/z/route.ts', `
export async function GET(): Promise<Response> {
  const v = compute();
  if (v < 0) {
    return Response.json({ error: 'neg' }, { status: 400 });
  }
  return Response.json({ v });
}
`);
    await writeFile(cwd, '.zerou/test-results.json', JSON.stringify([
      {
        spec: {
          id: 'z-1',
          name: 'rejects negative',
          category: 'validation',
          scope: { type: 'endpoint', target: 'GET /api/z', file: 'app/api/z/route.ts', line: 2 },
          given: 'neg value',
          when: 'GET',
          then: 'returns 400 negative',
          reasoning: 'r',
        },
        status: 'fail', // judge FAILED → not coverage
        verdictReason: 'branch not implemented',
        evidence: {
          file: 'app/api/z/route.ts',
          line: 5,
          snippet: '{ status: 400 }',
        },
        criticFamily: 'test',
        durationMs: 50,
      },
    ]));
    // Runtime present (so runtimeAvailable=true) but the if-true body NOT hit.
    await writeFile(cwd, 'coverage/coverage-final.json', JSON.stringify({
      'app/api/z/route.ts': {
        path: 'app/api/z/route.ts',
        statementMap: {
          '0': { start: { line: 3, column: 0 }, end: { line: 3, column: 40 } },
        },
        s: { '0': 4 }, // line 3 (the `const v` / condition) hit, body line 5 not
        branchMap: {},
        b: {},
      },
    }));

    const report = await collectBranchCoverage({ cwd, logger });
    const fn = report.functions.find((f) => f.name === 'GET')!;
    const ifTrue = fn.root.children.find((c) => c.kind === 'if-true')!;
    expect(ifTrue.specMatches.length).toBeGreaterThan(0);
    // Judge evidence is still recorded (status fail), but it must NOT promote.
    expect(ifTrue.judgeEvidence.some((e) => e.status === 'fail')).toBe(true);
    expect(ifTrue.verdict).not.toBe('covered');
    expect(ifTrue.verdict).not.toBe('judge-only');
    expect(ifTrue.verdict).toBe('spec-only');
  });

  // Bug 1 (run signal): when istanbul provides a per-arm branchHit=false for the
  // node, an incidental line hit inside the range must NOT mark it covered.
  it('branchHit=false beats incidental line hit → not run-covered (Bug 1)', async () => {
    const cwd = await tmpdir();
    const logger = makeLogger(cwd);
    await writeFile(cwd, 'src/util.ts', `
export function f(x: number) {
  if (x < 0) {
    return 'neg';
  }
  return 'pos';
}
`);
    // statementMap marks line 3-4 as hit (incidental), but the branchMap says
    // the if-true ARM at line 3 was NOT taken (hit=false). branchHit must win.
    await writeFile(cwd, 'coverage/coverage-final.json', JSON.stringify({
      'src/util.ts': {
        path: 'src/util.ts',
        statementMap: {
          '0': { start: { line: 3, column: 0 }, end: { line: 4, column: 30 } },
        },
        s: { '0': 7 }, // lines 3-4 "hit"
        branchMap: {
          '0': {
            line: 3,
            type: 'if',
            loc: { start: { line: 3, column: 2 }, end: { line: 5, column: 3 } },
            locations: [
              // True arm lives inside the if-true node range (lines 3-5).
              { start: { line: 3, column: 2 }, end: { line: 5, column: 3 } },
              // Implicit false/else arm reported at the post-if line (6) — OUTSIDE
              // the if-true node range, so it cannot leak into this node's hit.
              { start: { line: 6, column: 2 }, end: { line: 6, column: 14 } },
            ],
          },
        },
        b: { '0': [0, 1] }, // true arm taken 0 times, false arm 1 time
      },
    }));

    const report = await collectBranchCoverage({ cwd, logger });
    expect(report.availability.runtime).toBe(true);
    const fn = report.functions.find((f) => f.name === 'f')!;
    const ifTrue = fn.root.children.find((c) => c.kind === 'if-true')!;
    expect(ifTrue.runtimeCoverage.linesCovered).toBeGreaterThan(0); // incidental
    expect(ifTrue.runtimeCoverage.branchHit).toBe(false); // arm NOT taken
    // No spec, no judge, branchHit=false → must be untested, NOT run-only/covered.
    expect(ifTrue.verdict).toBe('untested');
  });

  // Bug 2 (denominator): a function with exactly one covered if-branch must
  // contribute branchesTotal = 1 (entry root excluded) and reach 100%.
  it('one covered if-branch → branchesTotal excludes entry (Bug 2)', async () => {
    const cwd = await tmpdir();
    const logger = makeLogger(cwd);
    // Single decision with else: `if (x < 0) {} else {}`. AST emits
    // entry + if-true + if-false = 3 flat nodes; only 2 are real branches.
    // Old (buggy) code counted 3 (entry inflated the denominator).
    await writeFile(cwd, 'src/single.ts', `
export function g(x: number) {
  if (x < 0) {
    return 'neg';
  } else {
    return 'pos';
  }
}
`);
    const report = await collectBranchCoverage({ cwd, logger });
    const fn = report.functions.find((f) => f.name === 'g')!;
    // Count real branches by traversing the tree (root is the entry node).
    const realBranches = countDescendants(fn.root); // excludes root/entry itself
    expect(realBranches).toBeGreaterThanOrEqual(2); // if-true + if-false
    // branchCount must EXCLUDE the entry root.
    expect(fn.branchCount).toBe(realBranches);
    // summary.branchesTotal (single fn) must equal that per-function count.
    expect(report.summary.branchesTotal).toBe(fn.branchCount);
    // The entry root must NOT be counted: branchCount == (flat - 1).
    expect(fn.branchCount).toBe(countDescendants(fn.root));
  });

  it('zero-branch function → branchesTotal 0, no entry inflation (Bug 2)', async () => {
    const cwd = await tmpdir();
    const logger = makeLogger(cwd);
    await writeFile(cwd, 'src/noop.ts', `export function h() { return 1; }\n`);
    const report = await collectBranchCoverage({ cwd, logger });
    const fn = report.functions.find((f) => f.name === 'h')!;
    // Only the entry root exists → 0 real branches.
    expect(fn.branchCount).toBe(0);
    expect(report.summary.branchesTotal).toBe(0);
  });

  it('writeBranchCoverage atomically writes .zerou/branch-coverage.json', async () => {
    const cwd = await tmpdir();
    const logger = makeLogger(cwd);
    await writeFile(cwd, 'src/empty.ts', `export function f() { return 1; }\n`);
    const report = await collectBranchCoverage({ cwd, logger });
    const target = writeBranchCoverage(cwd, report);
    const raw = await fsp.readFile(target, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.summary.functionsAnalyzed).toBe(report.summary.functionsAnalyzed);
    expect(target.endsWith('branch-coverage.json')).toBe(true);
  });
});

// ── Smoke against synthetic Next.js fixture ────────────────────────────────

describe('collectBranchCoverage real-shape smoke', () => {
  it('handles a Next.js route with multiple ifs + populates summary numbers', async () => {
    const cwd = await tmpdir();
    const logger = makeLogger(cwd);

    await writeFile(cwd, 'app/api/memes/[id]/route.ts', `
import { NextResponse } from 'next/server';
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const memeId = Number.parseInt(id, 10);
  if (!Number.isFinite(memeId) || memeId <= 0) {
    return NextResponse.json({ error: 'invalid meme id' }, { status: 400 });
  }
  const meme = lookup(memeId);
  if (!meme) {
    return NextResponse.json({ error: 'meme not found' }, { status: 404 });
  }
  return NextResponse.json({ meme });
}
`);

    await writeFile(cwd, '.zerou/test-results.json', JSON.stringify([
      {
        spec: {
          id: 'memes-1',
          name: 'rejects invalid id',
          category: 'validation',
          scope: { type: 'endpoint', target: 'GET /api/memes/[id]', file: 'app/api/memes/[id]/route.ts', line: 3 },
          given: 'invalid id',
          when: 'GET',
          then: 'returns 400 invalid meme',
          reasoning: '',
        },
        status: 'fail',
        verdictReason: 'no validation',
        evidence: {
          file: 'app/api/memes/[id]/route.ts',
          line: 7,
          snippet: '{ status: 400 }',
        },
        criticFamily: 'test',
        durationMs: 80,
      },
    ]));

    const report = await collectBranchCoverage({ cwd, logger });
    expect(report.summary.functionsAnalyzed).toBe(1);
    const fn = report.functions[0]!;
    expect(fn.name).toBe('GET');
    // Two ifs → at least 2 if-true children at root.
    const ifNodes = fn.root.children.filter((c) => c.kind === 'if-true');
    expect(ifNodes.length).toBeGreaterThanOrEqual(2);
    // Spec targeting GET /api/memes/[id] should match by route normalisation.
    expect(fn.associatedSpecs.length).toBeGreaterThanOrEqual(1);
  });
});
