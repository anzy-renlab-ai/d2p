/**
 * Tests for branch-tree-renderer.ts (Phase 11.5 FUNCTIONS section).
 */
import { describe, it, expect } from 'vitest';

import {
  renderFunctionsSection,
  renderFunctionRow,
  renderFunctionSummary,
  renderBranchTree,
  buildAsciiTreeRows,
  __branchTreeInternals,
} from './branch-tree-renderer.js';
import type {
  BranchCoverageReport,
  BranchNode,
  BranchVerdict,
  FunctionCoverage,
} from '../agent/branch-coverage-types.js';

// ── Factories ──────────────────────────────────────────────────────────────

function makeBranch(
  id: string,
  label: string,
  verdict: BranchVerdict,
  children: BranchNode[] = [],
  over: Partial<BranchNode> = {},
): BranchNode {
  return {
    id,
    label,
    lineStart: 1,
    lineEnd: 2,
    kind: 'if-true',
    children,
    ast: { present: true },
    specMatches: [],
    judgeEvidence: [],
    runtimeCoverage: { linesTotal: 1, linesCovered: 0, branchHit: null },
    verdict,
    ...over,
  };
}

function makeFn(over: Partial<FunctionCoverage> = {}): FunctionCoverage {
  const root: BranchNode = over.root ?? makeBranch('entry', 'entry', 'covered');
  return {
    id: over.id ?? 'app/api/login.ts:handleLogin@5',
    file: over.file ?? 'app/api/login.ts',
    name: over.name ?? 'handleLogin',
    line: over.line ?? 5,
    branchCount: over.branchCount ?? 1,
    coveredCount: over.coveredCount ?? 1,
    selfDeceivingCount: over.selfDeceivingCount ?? 0,
    untestedCount: over.untestedCount ?? 0,
    root,
    associatedSpecs: over.associatedSpecs ?? [],
    ...over,
    // make sure overridden fields stay overridden
  };
}

function makeReport(functions: FunctionCoverage[]): BranchCoverageReport {
  let branchesTotal = 0;
  let branchesCovered = 0;
  let selfDeceivingTotal = 0;
  let untestedTotal = 0;
  let functionsWithSelfDeception = 0;
  for (const fn of functions) {
    branchesTotal += fn.branchCount;
    branchesCovered += fn.coveredCount;
    selfDeceivingTotal += fn.selfDeceivingCount;
    untestedTotal += fn.untestedCount;
    if (fn.selfDeceivingCount > 0) functionsWithSelfDeception++;
  }
  return {
    generatedAt: new Date(0).toISOString(),
    cwd: '/tmp/demo',
    functions,
    summary: {
      functionsAnalyzed: functions.length,
      branchesTotal,
      branchesCovered,
      selfDeceivingTotal,
      untestedTotal,
      functionsWithSelfDeception,
    },
    availability: { ast: true, spec: true, judge: true, runtime: true },
  };
}

// ── Section-level rendering ────────────────────────────────────────────────

describe('renderFunctionsSection', () => {
  it('renders "No functions analyzed" placeholder for an empty report', () => {
    const out = renderFunctionsSection(makeReport([]));
    expect(out).toContain('No functions analyzed');
    expect(out).toContain('0 functions analyzed');
  });

  it('renders one row per function and the header counts', () => {
    const fns = [
      makeFn({ id: 'a', file: 'a.ts', name: 'A' }),
      makeFn({ id: 'b', file: 'b.ts', name: 'B' }),
    ];
    const out = renderFunctionsSection(makeReport(fns));
    expect(out.match(/<details class="row fn-row"/g)?.length).toBe(2);
    expect(out).toContain('<strong>2</strong> functions');
  });

  it('header shows self-deceiving count and untested branch count', () => {
    const deceived: BranchNode = makeBranch('br', 'pw mismatch', 'judge-only');
    const fn = makeFn({
      selfDeceivingCount: 1,
      untestedCount: 0,
      branchCount: 2,
      coveredCount: 1,
      root: makeBranch('root', 'root', 'covered', [deceived]),
    });
    const report = makeReport([fn]);
    const out = renderFunctionsSection(report);
    expect(out).toMatch(/1 self-deceiving/);
    expect(out).toMatch(/0 untested branches/);
  });

  it('renders the filter dropdown with all four verdict options', () => {
    const out = renderFunctionsSection(makeReport([makeFn()]));
    expect(out).toContain('id="fn-verdict-filter"');
    expect(out).toContain('value="all"');
    expect(out).toContain('value="self-deceiving"');
    expect(out).toContain('value="untested"');
    expect(out).toContain('value="covered"');
  });

  it('renders the free-text name filter input', () => {
    const out = renderFunctionsSection(makeReport([makeFn()]));
    expect(out).toContain('id="fn-name-filter"');
  });

  it('sorts self-deceiving functions before clean ones', () => {
    const cleanFn = makeFn({ id: 'clean', file: 'clean.ts', name: 'clean' });
    const dirtyFn = makeFn({
      id: 'dirty',
      file: 'dirty.ts',
      name: 'dirty',
      selfDeceivingCount: 2,
      branchCount: 5,
      coveredCount: 2,
    });
    const out = renderFunctionsSection(makeReport([cleanFn, dirtyFn]));
    expect(out.indexOf('data-fn-id="dirty"')).toBeLessThan(out.indexOf('data-fn-id="clean"'));
  });
});

// ── Function row data attributes ───────────────────────────────────────────

describe('renderFunctionRow', () => {
  it('exposes data-fn-* attributes used by the filter JS', () => {
    const fn = makeFn({
      file: 'app/api/login.ts',
      name: 'handleLogin',
      branchCount: 6,
      coveredCount: 5,
      selfDeceivingCount: 1,
      untestedCount: 0,
    });
    const row = renderFunctionRow(fn);
    expect(row).toContain('data-fn-self-deceiving="1"');
    expect(row).toContain('data-fn-untested="0"');
    expect(row).toContain('data-fn-covered="5"');
    expect(row).toContain('data-fn-name="handlelogin app/api/login.ts"');
  });

  it('escapes HTML in function name and file path', () => {
    const fn = makeFn({ file: 'a/<x>.ts', name: 'foo<bar>' });
    const row = renderFunctionRow(fn);
    expect(row).toContain('a/&lt;x&gt;.ts');
    expect(row).toContain('foo&lt;bar&gt;');
    expect(row).not.toContain('<x>.ts');
  });

  it('function row glyph: ✅ when fully covered', () => {
    const row = renderFunctionRow(makeFn({ selfDeceivingCount: 0, untestedCount: 0 }));
    expect(row).toMatch(/<span class="fn-glyph fn-covered">✅<\/span>/);
  });

  it('function row glyph: ⚠ when only untested branches', () => {
    const row = renderFunctionRow(makeFn({ selfDeceivingCount: 0, untestedCount: 1 }));
    expect(row).toMatch(/<span class="fn-glyph fn-partial">⚠<\/span>/);
  });

  it('function row glyph: 🔴 when any self-deceiving branch', () => {
    const row = renderFunctionRow(makeFn({ selfDeceivingCount: 1, untestedCount: 0 }));
    expect(row).toMatch(/<span class="fn-glyph fn-deceiving">🔴<\/span>/);
  });
});

// ── renderFunctionSummary ──────────────────────────────────────────────────

describe('renderFunctionSummary', () => {
  it('shows branch count, covered, untested, self-deceiving stats', () => {
    const fn = makeFn({
      branchCount: 6,
      coveredCount: 5,
      untestedCount: 0,
      selfDeceivingCount: 1,
    });
    const summary = renderFunctionSummary(fn);
    expect(summary).toContain('<strong>6</strong> br');
    expect(summary).toContain('>5<');
    expect(summary).toContain('>0<');
    expect(summary).toContain('>1<');
  });

  it('shows spec count badge', () => {
    const fn = makeFn({
      associatedSpecs: [
        { specId: 's1', specName: 'foo', status: 'pass', category: 'auth' },
        { specId: 's2', specName: 'bar', status: 'pass', category: 'auth' },
      ],
    });
    const summary = renderFunctionSummary(fn);
    expect(summary).toContain('[2 specs]');
  });

  it('pluralizes singular spec count', () => {
    const fn = makeFn({
      associatedSpecs: [{ specId: 's1', specName: 'foo', status: 'pass', category: 'auth' }],
    });
    expect(renderFunctionSummary(fn)).toContain('[1 spec]');
  });
});

// ── Branch tree rendering ──────────────────────────────────────────────────

describe('renderBranchTree', () => {
  it('renders header with branch counts', () => {
    const fn = makeFn({ branchCount: 6, coveredCount: 5, selfDeceivingCount: 1, line: 5 });
    const out = renderBranchTree(fn);
    expect(out).toContain('handleLogin · app/api/login.ts:5');
    expect(out).toContain('6 branches');
    expect(out).toContain('5 covered');
    expect(out).toContain('1 self-deceiving');
  });

  it('shows "no branches found" placeholder for empty root', () => {
    const root: BranchNode = {
      id: '',
      label: '',
      lineStart: 0,
      lineEnd: 0,
      kind: 'entry',
      children: [],
      ast: { present: true },
      specMatches: [],
      judgeEvidence: [],
      runtimeCoverage: { linesTotal: 0, linesCovered: 0, branchHit: null },
      verdict: 'unknown',
    };
    const fn = makeFn({ root, branchCount: 0, coveredCount: 0 });
    const out = renderBranchTree(fn);
    expect(out).toContain('no branches found');
  });

  it('renders 1 row when only entry branch exists', () => {
    const fn = makeFn({
      root: makeBranch('entry', 'entry', 'covered'),
    });
    const out = renderBranchTree(fn);
    expect((out.match(/<div class="branch-row /g) ?? []).length).toBe(1);
  });

  it('renders entry + two children (if-true / if-false) as 3 rows', () => {
    const ifTrue = makeBranch('if-true', 'TRUE → 400', 'covered');
    const ifFalse = makeBranch('if-false', 'FALSE', 'covered');
    const fn = makeFn({
      root: makeBranch('entry', 'entry', 'covered', [ifTrue, ifFalse]),
    });
    const out = renderBranchTree(fn);
    expect((out.match(/<div class="branch-row /g) ?? []).length).toBe(3);
  });
});

// ── ASCII tree drawing rules ───────────────────────────────────────────────

describe('buildAsciiTreeRows', () => {
  it('uses ├── for non-last sibling and └── for last sibling', () => {
    const c1 = makeBranch('c1', 'first', 'covered');
    const c2 = makeBranch('c2', 'last', 'covered');
    const root = makeBranch('root', 'root', 'covered', [c1, c2]);
    const rows = buildAsciiTreeRows(root);
    expect(rows[0]).toContain('class="branch-row');
    // c1 is non-last
    expect(rows[1]).toContain('├── ');
    // c2 is last
    expect(rows[2]).toContain('└── ');
  });

  it('uses │   prefix on grandchildren of non-last branches', () => {
    const grandchild = makeBranch('g', 'grandchild', 'covered');
    const c1 = makeBranch('c1', 'first', 'covered', [grandchild]);
    const c2 = makeBranch('c2', 'last', 'covered');
    const root = makeBranch('root', 'root', 'covered', [c1, c2]);
    const rows = buildAsciiTreeRows(root);
    // grandchild row should be 4 deep
    const grandRow = rows[2] ?? '';
    expect(grandRow).toContain('│   ');
    expect(grandRow).toContain('└── ');
  });

  it('uses 4-space pad for grandchildren of the last sibling', () => {
    const grandchild = makeBranch('g', 'grandchild', 'covered');
    const c2 = makeBranch('c2', 'last', 'covered', [grandchild]);
    const root = makeBranch('root', 'root', 'covered', [c2]);
    const rows = buildAsciiTreeRows(root);
    const grandRow = rows[2] ?? '';
    // After "└── " on c2, the grandchild row prefix should start with 4 spaces.
    expect(grandRow).toContain('    └── ');
    // No vertical bar at this level since c2 was last.
    expect(grandRow).not.toContain('│   └── ');
  });

  it('is pure: same input yields identical output', () => {
    const root = makeBranch('r', 'r', 'covered', [makeBranch('a', 'a', 'covered')]);
    const a = buildAsciiTreeRows(root);
    const b = buildAsciiTreeRows(root);
    expect(a.join('')).toEqual(b.join(''));
  });

  it('handles very deep nesting without throwing', () => {
    let node: BranchNode = makeBranch('leaf', 'leaf', 'covered');
    for (let i = 0; i < 12; i++) {
      node = makeBranch(`n${i}`, `n${i}`, 'covered', [node]);
    }
    const rows = buildAsciiTreeRows(node);
    expect(rows.length).toBe(13);
    // Last row should be deeply indented.
    expect((rows[12] ?? '').length).toBeGreaterThan((rows[0] ?? '').length);
  });
});

// ── Verdict mapping (branchGlyph) ──────────────────────────────────────────

describe('branchGlyph', () => {
  it('maps each BranchVerdict to glyph + CSS class', () => {
    const { branchGlyph } = __branchTreeInternals;
    expect(branchGlyph('covered').glyph).toBe('✅');
    expect(branchGlyph('covered').cls).toBe('bn-covered');
    expect(branchGlyph('judge-only').glyph).toBe('🔴');
    expect(branchGlyph('judge-only').cls).toBe('bn-judge-only');
    expect(branchGlyph('untested').glyph).toBe('🔴');
    expect(branchGlyph('untested').cls).toBe('bn-untested');
    expect(branchGlyph('spec-only').glyph).toBe('⚠');
    expect(branchGlyph('run-only').glyph).toBe('⚠');
    expect(branchGlyph('unknown').glyph).toBe('·');
  });
});

// ── 4 signal badges ────────────────────────────────────────────────────────

describe('signal badges', () => {
  it('emits AST + SPEC + JUDGE + RUN badges for every branch', () => {
    const root = makeBranch('root', 'root', 'covered', [], {
      specMatches: [{ specId: 's1', specName: 'login-1', matchedTokens: ['401'] }],
      judgeEvidence: [{ specId: 's1', status: 'pass', snippet: 'return 401' }],
      runtimeCoverage: { linesTotal: 1, linesCovered: 1, branchHit: true },
    });
    const fn = makeFn({ root });
    const out = renderBranchTree(fn);
    expect(out).toContain('bn-badge-ast');
    expect(out).toContain('bn-badge-spec');
    expect(out).toContain('bn-badge-judge');
    expect(out).toContain('bn-badge-run');
    expect(out).toContain('SPEC login-1');
    expect(out).toContain('JUDGE ✓');
    expect(out).toContain('RUN ✓');
  });

  it('SPEC badge shows "no specs" when none matched', () => {
    const fn = makeFn({ root: makeBranch('r', 'r', 'untested') });
    const out = renderBranchTree(fn);
    expect(out).toContain('no specs');
  });

  it('JUDGE — when no evidence; JUDGE ✗ when only fail evidence', () => {
    const root1 = makeBranch('r1', 'r1', 'untested');
    expect(renderBranchTree(makeFn({ root: root1 }))).toContain('JUDGE —');

    const root2 = makeBranch('r2', 'r2', 'judge-only', [], {
      judgeEvidence: [{ specId: 's', status: 'fail', snippet: 'x' }],
    });
    expect(renderBranchTree(makeFn({ root: root2 }))).toContain('JUDGE ✗');
  });

  it('RUN — when branchHit=null; RUN ✓ on true; RUN ✗ on false', () => {
    const rNull = makeBranch('r', 'r', 'untested', [], {
      runtimeCoverage: { linesTotal: 0, linesCovered: 0, branchHit: null },
    });
    expect(renderBranchTree(makeFn({ root: rNull }))).toContain('RUN —');

    const rTrue = makeBranch('r', 'r', 'covered', [], {
      runtimeCoverage: { linesTotal: 1, linesCovered: 1, branchHit: true },
    });
    expect(renderBranchTree(makeFn({ root: rTrue }))).toContain('RUN ✓');

    const rFalse = makeBranch('r', 'r', 'judge-only', [], {
      runtimeCoverage: { linesTotal: 1, linesCovered: 0, branchHit: false },
    });
    expect(renderBranchTree(makeFn({ root: rFalse }))).toContain('RUN ✗');
  });
});

// ── Self-deceiving marker text ─────────────────────────────────────────────

describe('self-deceiving marker', () => {
  it('renders "self-deceiving" marker on judge-only branches', () => {
    const child = makeBranch('c', 'pw mismatch', 'judge-only');
    const root = makeBranch('r', 'r', 'covered', [child]);
    const fn = makeFn({ root, selfDeceivingCount: 1 });
    const out = renderBranchTree(fn);
    expect(out).toContain('self-deceiving');
  });

  it('does NOT render marker on covered branches', () => {
    const child = makeBranch('c', 'c', 'covered');
    const root = makeBranch('r', 'r', 'covered', [child]);
    const out = renderBranchTree(makeFn({ root }));
    expect(out).not.toContain('bn-marker-deceiving');
  });
});

// ── Branch row data attrs ──────────────────────────────────────────────────

describe('renderBranchRow data attrs', () => {
  it('carries data-verdict and data-branch-id for downstream tooling', () => {
    const root = makeBranch('root', 'root', 'covered', [
      makeBranch('br-1', 'first', 'judge-only'),
    ]);
    const out = renderBranchTree(makeFn({ root }));
    expect(out).toContain('data-branch-id="br-1"');
    expect(out).toContain('data-verdict="self-deceiving"');
  });

  it('escapes HTML in branch labels', () => {
    const child = makeBranch('c', '<script>alert(1)</script>', 'covered');
    const root = makeBranch('r', 'r', 'covered', [child]);
    const out = renderBranchTree(makeFn({ root }));
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;');
  });
});
