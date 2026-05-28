import { describe, it, expect } from 'vitest';
import {
  deriveBranchState,
  classifyRedCategory,
  aggregateFileState,
  compareStates,
  type BranchTraceEventLite,
} from './branchState.js';
import type { BranchTraceEvent } from '../types-zerou.js';

function mkEvent(overrides: Partial<BranchTraceEventLite> = {}): BranchTraceEventLite {
  const base: BranchTraceEvent = {
    ts: '2026-05-27T16:13:42.117Z',
    trace_id: 'TRACE',
    event: 'branch.evidence',
    branch_id: 'x',
    branch_kind: 'block',
    branch_label: 'noop',
    line_start: 1,
    line_end: 1,
    'code.function': 'fn',
    'code.file.path': 'a.ts',
    'code.line.number': 1,
    signals: { ast: true, spec: false, judge: false, run: null },
    verdict: 'untested',
    evidence: { spec_ids: [] },
    seq: 1,
    prev_hash: '0',
    hash: '1',
  };
  return { ...base, ...overrides };
}

describe('deriveBranchState', () => {
  it('returns explicit state when present (covered)', () => {
    const ev = mkEvent({ state: 'covered', verdict: 'untested' });
    expect(deriveBranchState(ev)).toBe('covered');
  });

  it('returns explicit state when present (evaluating)', () => {
    const ev = mkEvent({ state: 'evaluating', verdict: 'untested' });
    expect(deriveBranchState(ev)).toBe('evaluating');
  });

  it('returns explicit state when present (retrying)', () => {
    const ev = mkEvent({ state: 'retrying', verdict: 'covered' });
    expect(deriveBranchState(ev)).toBe('retrying');
  });

  it('derives covered from verdict=covered when no explicit state', () => {
    const ev = mkEvent({ verdict: 'covered' });
    expect(deriveBranchState(ev)).toBe('covered');
  });

  it('derives covered from verdict=run-only', () => {
    const ev = mkEvent({ verdict: 'run-only' });
    expect(deriveBranchState(ev)).toBe('covered');
  });

  it('derives mechanical-red from category=mechanical', () => {
    const ev = mkEvent({ verdict: 'untested', category: 'mechanical' });
    expect(deriveBranchState(ev)).toBe('mechanical-red');
  });

  it('derives business-red from category=business', () => {
    const ev = mkEvent({ verdict: 'untested', category: 'business' });
    expect(deriveBranchState(ev)).toBe('business-red');
  });

  it('partial signal (judge-only) still treated as red', () => {
    const ev = mkEvent({ verdict: 'judge-only', branch_kind: 'block', branch_label: 'noop' });
    const s = deriveBranchState(ev);
    expect(s === 'mechanical-red' || s === 'business-red').toBe(true);
  });
});

describe('classifyRedCategory heuristics', () => {
  it('catch block → mechanical-red', () => {
    const ev = mkEvent({ branch_kind: 'catch', branch_label: 'catch (e)' });
    expect(classifyRedCategory(ev)).toBe('mechanical-red');
  });

  it('try-body → mechanical-red', () => {
    const ev = mkEvent({ branch_kind: 'try-body', branch_label: 'try { ... }' });
    expect(classifyRedCategory(ev)).toBe('mechanical-red');
  });

  it('finally → mechanical-red', () => {
    const ev = mkEvent({ branch_kind: 'finally', branch_label: 'finally cleanup' });
    expect(classifyRedCategory(ev)).toBe('mechanical-red');
  });

  it('auth keyword → business-red', () => {
    const ev = mkEvent({ branch_kind: 'if-true', branch_label: 'if (user.auth)' });
    expect(classifyRedCategory(ev)).toBe('business-red');
  });

  it('admin keyword → business-red', () => {
    const ev = mkEvent({ branch_kind: 'if-true', branch_label: 'if (admin)' });
    expect(classifyRedCategory(ev)).toBe('business-red');
  });

  it('user_id ownership keyword → business-red', () => {
    const ev = mkEvent({ branch_kind: 'if-true', branch_label: 'if (post.user_id === current)' });
    expect(classifyRedCategory(ev)).toBe('business-red');
  });

  it('encodeURIComponent in label → mechanical-red', () => {
    const ev = mkEvent({ branch_kind: 'block', branch_label: 'missing encodeURIComponent' });
    expect(classifyRedCategory(ev)).toBe('mechanical-red');
  });

  it('sanitize hint → mechanical-red', () => {
    const ev = mkEvent({ branch_kind: 'block', branch_label: 'sanitize input' });
    expect(classifyRedCategory(ev)).toBe('mechanical-red');
  });

  it('null-check hint → mechanical-red', () => {
    const ev = mkEvent({ branch_kind: 'block', branch_label: 'add null check' });
    expect(classifyRedCategory(ev)).toBe('mechanical-red');
  });

  it('unknown branch_kind + unknown label → conservative business-red', () => {
    const ev = mkEvent({ branch_kind: 'block', branch_label: 'something' });
    expect(classifyRedCategory(ev)).toBe('business-red');
  });

  it('auth keyword inside catch block: auth wins → business-red', () => {
    // Auth checks dominate even if syntactically a catch — better to flag for
    // human review than mis-classify as mechanically fixable.
    const ev = mkEvent({ branch_kind: 'catch', branch_label: 'catch (auth error)' });
    expect(classifyRedCategory(ev)).toBe('business-red');
  });
});

describe('aggregateFileState', () => {
  it('empty events → pending + zero counts', () => {
    const b = aggregateFileState([]);
    expect(b.total).toBe(0);
    expect(b.aggregate).toBe('pending');
  });

  it('all covered → aggregate covered', () => {
    const evs = [
      mkEvent({ verdict: 'covered' }),
      mkEvent({ verdict: 'covered', seq: 2 }),
    ];
    const b = aggregateFileState(evs);
    expect(b.covered).toBe(2);
    expect(b.aggregate).toBe('covered');
  });

  it('mixed bag → aggregate mixed', () => {
    const evs = [
      mkEvent({ verdict: 'covered' }),
      mkEvent({ verdict: 'untested', branch_kind: 'catch', branch_label: 'catch' }), // mech-red
      mkEvent({ verdict: 'untested', branch_label: 'if (admin)' }), // biz-red
    ];
    const b = aggregateFileState(evs);
    expect(b.covered).toBe(1);
    expect(b.mechanicalRed).toBe(1);
    expect(b.businessRed).toBe(1);
    expect(b.aggregate).toBe('mixed');
  });

  it('all business-red → aggregate business-red', () => {
    const evs = [
      mkEvent({ verdict: 'untested', branch_label: 'if (auth)' }),
      mkEvent({ verdict: 'untested', branch_label: 'if (admin)', seq: 2 }),
    ];
    const b = aggregateFileState(evs);
    expect(b.businessRed).toBe(2);
    expect(b.aggregate).toBe('business-red');
  });

  it('all evaluating → aggregate evaluating', () => {
    const evs = [
      mkEvent({ state: 'evaluating' }),
      mkEvent({ state: 'evaluating', seq: 2 }),
    ];
    const b = aggregateFileState(evs);
    expect(b.evaluating).toBe(2);
    expect(b.aggregate).toBe('evaluating');
  });
});

describe('compareStates sort priority', () => {
  it('business-red sorts before mechanical-red', () => {
    expect(compareStates('business-red', 'mechanical-red')).toBeLessThan(0);
  });
  it('mechanical-red sorts before covered', () => {
    expect(compareStates('mechanical-red', 'covered')).toBeLessThan(0);
  });
  it('covered sorts after pending', () => {
    expect(compareStates('covered', 'pending')).toBeGreaterThan(0);
  });
});
