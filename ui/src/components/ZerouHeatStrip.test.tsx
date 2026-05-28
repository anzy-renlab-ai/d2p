import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZerouHeatStrip } from './ZerouHeatStrip.js';
import type { BranchTraceEventLite } from '../lib/branchState.js';
import type { BranchTraceEvent } from '../types-zerou.js';

function mkEvent(overrides: Partial<BranchTraceEventLite> = {}): BranchTraceEventLite {
  const base: BranchTraceEvent = {
    ts: '2026-05-27T16:13:42.117Z',
    trace_id: 'TRACE',
    event: 'branch.evidence',
    branch_id: `b-${overrides.seq ?? 1}`,
    branch_kind: 'block',
    branch_label: 'noop',
    line_start: 1,
    line_end: 1,
    'code.function': 'fn',
    'code.file.path': 'app/api/x/route.ts',
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

describe('ZerouHeatStrip', () => {
  it('renders one square per distinct file', () => {
    const events = [
      mkEvent({ 'code.file.path': 'a.ts', seq: 1 }),
      mkEvent({ 'code.file.path': 'a.ts', seq: 2 }),
      mkEvent({ 'code.file.path': 'b.ts', seq: 3 }),
      mkEvent({ 'code.file.path': 'c.ts', seq: 4 }),
    ];
    render(<ZerouHeatStrip events={events} />);
    const grid = screen.getByTestId('zerou-heat-strip-grid');
    const squares = grid.querySelectorAll('[data-testid^="zerou-heat-strip-square-"]');
    expect(squares.length).toBe(3);
  });

  it('renders "no data" placeholder when events is empty', () => {
    render(<ZerouHeatStrip events={[]} />);
    expect(screen.getByTestId('zerou-heat-strip')).toHaveTextContent(/no data/i);
  });

  it('file with 100% covered → aggregate=covered', () => {
    const events = [
      mkEvent({ 'code.file.path': 'all-green.ts', verdict: 'covered', seq: 1 }),
      mkEvent({ 'code.file.path': 'all-green.ts', verdict: 'covered', seq: 2 }),
    ];
    render(<ZerouHeatStrip events={events} />);
    const sq = screen.getByTestId('zerou-heat-strip-square-all-green-ts');
    expect(sq.getAttribute('data-aggregate')).toBe('covered');
  });

  it('file with mixed states has aggregate=mixed and a gradient background', () => {
    const events = [
      mkEvent({ 'code.file.path': 'mixed.ts', verdict: 'covered', seq: 1 }),
      mkEvent({
        'code.file.path': 'mixed.ts',
        verdict: 'untested',
        branch_kind: 'catch',
        branch_label: 'catch',
        seq: 2,
      }),
      mkEvent({
        'code.file.path': 'mixed.ts',
        verdict: 'untested',
        branch_label: 'if (admin)',
        seq: 3,
      }),
    ];
    render(<ZerouHeatStrip events={events} />);
    const sq = screen.getByTestId('zerou-heat-strip-square-mixed-ts');
    expect(sq.getAttribute('data-aggregate')).toBe('mixed');
    // Mixed files use inline backgroundImage gradient, not bg-* class.
    const inlineBg = (sq as HTMLElement).style.backgroundImage;
    expect(inlineBg).toContain('linear-gradient');
  });

  it('click on a square triggers onJumpToFile with the file path', () => {
    const events = [mkEvent({ 'code.file.path': 'click-me.ts', seq: 1 })];
    const onJump = vi.fn();
    render(<ZerouHeatStrip events={events} onJumpToFile={onJump} />);
    fireEvent.click(screen.getByTestId('zerou-heat-strip-square-click-me-ts'));
    expect(onJump).toHaveBeenCalledWith('click-me.ts');
  });

  it('hover on a square shows the tooltip with file path + counts', () => {
    const events = [
      mkEvent({ 'code.file.path': 'tooltip.ts', verdict: 'covered', seq: 1 }),
      mkEvent({ 'code.file.path': 'tooltip.ts', verdict: 'untested', seq: 2 }),
    ];
    render(<ZerouHeatStrip events={events} />);
    fireEvent.mouseEnter(screen.getByTestId('zerou-heat-strip-square-tooltip-ts'));
    const tt = screen.getByTestId('zerou-heat-strip-tooltip');
    expect(tt).toHaveTextContent('tooltip.ts');
    expect(tt).toHaveTextContent('1');
  });

  it('renders a large number of files without crashing', () => {
    const events: BranchTraceEventLite[] = [];
    for (let i = 0; i < 120; i++) {
      events.push(mkEvent({ 'code.file.path': `file-${i}.ts`, seq: i }));
    }
    render(<ZerouHeatStrip events={events} />);
    const squares = screen
      .getByTestId('zerou-heat-strip-grid')
      .querySelectorAll('[data-testid^="zerou-heat-strip-square-"]');
    expect(squares.length).toBe(120);
  });

  it('business-red files sort before covered files', () => {
    const events = [
      mkEvent({ 'code.file.path': 'green.ts', verdict: 'covered', seq: 1 }),
      mkEvent({
        'code.file.path': 'biz.ts',
        verdict: 'untested',
        branch_label: 'if (auth)',
        seq: 2,
      }),
    ];
    render(<ZerouHeatStrip events={events} />);
    const grid = screen.getByTestId('zerou-heat-strip-grid');
    const squares = grid.querySelectorAll('[data-testid^="zerou-heat-strip-square-"]');
    expect(squares.length).toBe(2);
    // First square should be biz.ts (business-red, RANK 0).
    expect(squares[0]?.getAttribute('data-testid')).toBe('zerou-heat-strip-square-biz-ts');
  });
});
