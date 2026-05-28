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
  it('renders one row per distinct file', () => {
    const events = [
      mkEvent({ 'code.file.path': 'a.ts', seq: 1 }),
      mkEvent({ 'code.file.path': 'a.ts', seq: 2 }),
      mkEvent({ 'code.file.path': 'b.ts', seq: 3 }),
      mkEvent({ 'code.file.path': 'c.ts', seq: 4 }),
    ];
    render(<ZerouHeatStrip events={events} />);
    const list = screen.getByTestId('zerou-heat-list');
    const rows = list.querySelectorAll('[data-testid^="zerou-heat-row-"]');
    expect(rows.length).toBe(3);
  });

  it('renders "no data" placeholder when events is empty', () => {
    render(<ZerouHeatStrip events={[]} />);
    expect(screen.getByTestId('zerou-heat-strip')).toHaveTextContent(/no data/i);
  });

  it('file with 100% covered → row data-aggregate=covered', () => {
    const events = [
      mkEvent({ 'code.file.path': 'all-green.ts', verdict: 'covered', seq: 1 }),
      mkEvent({ 'code.file.path': 'all-green.ts', verdict: 'covered', seq: 2 }),
    ];
    render(<ZerouHeatStrip events={events} />);
    const row = screen.getByTestId('zerou-heat-row-all-green-ts');
    expect(row.getAttribute('data-aggregate')).toBe('covered');
  });

  it('mixed-state file row carries aggregate=mixed', () => {
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
    const row = screen.getByTestId('zerou-heat-row-mixed-ts');
    expect(row.getAttribute('data-aggregate')).toBe('mixed');
  });

  it('click on a row triggers onJumpToFile with the file path', () => {
    const events = [mkEvent({ 'code.file.path': 'click-me.ts', seq: 1 })];
    const onJump = vi.fn();
    render(<ZerouHeatStrip events={events} onJumpToFile={onJump} />);
    fireEvent.click(screen.getByTestId('zerou-heat-row-click-me-ts'));
    expect(onJump).toHaveBeenCalledWith('click-me.ts');
  });

  it('row text contains the full file path', () => {
    const events = [
      mkEvent({ 'code.file.path': 'tooltip.ts', verdict: 'covered', seq: 1 }),
      mkEvent({ 'code.file.path': 'tooltip.ts', verdict: 'untested', seq: 2 }),
    ];
    render(<ZerouHeatStrip events={events} />);
    const row = screen.getByTestId('zerou-heat-row-tooltip-ts');
    expect(row).toHaveTextContent('tooltip.ts');
  });

  it('renders many files: default shows top 8 + a "show all" button', () => {
    const events: BranchTraceEventLite[] = [];
    for (let i = 0; i < 120; i++) {
      events.push(
        mkEvent({
          'code.file.path': `file-${i}.ts`,
          verdict: 'untested',
          branch_label: 'if (auth)',
          seq: i,
        }),
      );
    }
    render(<ZerouHeatStrip events={events} />);
    const visible = screen
      .getByTestId('zerou-heat-list')
      .querySelectorAll('[data-testid^="zerou-heat-row-"]');
    expect(visible.length).toBe(8);
    expect(screen.getByTestId('zerou-heat-show-all')).toHaveTextContent(/120 files/);
  });

  it('show-all toggles to render every file', () => {
    const events: BranchTraceEventLite[] = [];
    for (let i = 0; i < 30; i++) {
      events.push(mkEvent({ 'code.file.path': `f${i}.ts`, seq: i, branch_label: 'if (auth)' }));
    }
    render(<ZerouHeatStrip events={events} />);
    fireEvent.click(screen.getByTestId('zerou-heat-show-all'));
    const rows = screen
      .getByTestId('zerou-heat-list')
      .querySelectorAll('[data-testid^="zerou-heat-row-"]');
    expect(rows.length).toBe(30);
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
    const rows = screen
      .getByTestId('zerou-heat-list')
      .querySelectorAll('[data-testid^="zerou-heat-row-"]');
    expect(rows[0]?.getAttribute('data-testid')).toBe('zerou-heat-row-biz-ts');
  });

  it('renders the project-level overview bar', () => {
    const events = [
      mkEvent({ 'code.file.path': 'a.ts', verdict: 'covered', seq: 1 }),
      mkEvent({
        'code.file.path': 'b.ts',
        verdict: 'untested',
        branch_label: 'if (auth)',
        seq: 2,
      }),
    ];
    render(<ZerouHeatStrip events={events} />);
    expect(screen.getByTestId('zerou-heat-overview-bar')).toBeInTheDocument();
  });
});
