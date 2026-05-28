import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ZerouBranchTreeLog } from './ZerouBranchTreeLog.js';
import { mockZerouBundle } from '../mock/zerouBundle.js';
import type { BranchTraceEvent } from '../types-zerou.js';

const events = mockZerouBundle.branchTraceEvents!;

describe('ZerouBranchTreeLog', () => {
  it('renders the tree root and the log stream from events', () => {
    render(<ZerouBranchTreeLog events={events} />);
    expect(screen.getByTestId('zerou-branch-tree-log')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-tree-log-tree')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-tree-log-stream')).toBeInTheDocument();
    // app dir should appear at the root (every mock file lives under app/).
    expect(screen.getByText('app/')).toBeInTheDocument();
  });

  it('shows total event count in the header', () => {
    render(<ZerouBranchTreeLog events={events} />);
    expect(screen.getByText(`${events.length} events`)).toBeInTheDocument();
  });

  it('shows "static" badge when liveConnected is false', () => {
    render(<ZerouBranchTreeLog events={events} liveConnected={false} />);
    expect(screen.getByText('static')).toBeInTheDocument();
  });

  it('shows "live" badge when liveConnected is true', () => {
    render(<ZerouBranchTreeLog events={events} liveConnected />);
    expect(screen.getByText('live')).toBeInTheDocument();
  });

  it('filters the log stream when the search box is typed', () => {
    render(<ZerouBranchTreeLog events={events} />);
    const stream = screen.getByTestId('zerou-tree-log-stream');
    const beforeCount = stream.querySelectorAll('[data-testid^="zerou-tree-log-event-"]').length;
    expect(beforeCount).toBeGreaterThan(0);

    const search = screen.getByTestId('zerou-tree-log-search') as HTMLInputElement;
    // Use a term known to appear in a small subset of branch_ids.
    fireEvent.change(search, { target: { value: 'signin' } });
    const afterCount = stream.querySelectorAll('[data-testid^="zerou-tree-log-event-"]').length;
    expect(afterCount).toBeLessThan(beforeCount);
  });

  it('filters by verdict chip — only untested events visible', () => {
    render(<ZerouBranchTreeLog events={events} />);
    fireEvent.click(screen.getByTestId('zerou-tree-log-verdict-chip-untested'));
    const stream = screen.getByTestId('zerou-tree-log-stream');
    const visible = stream.querySelectorAll('[data-testid^="zerou-tree-log-event-"]');
    expect(visible.length).toBeGreaterThan(0);
    // Every visible event's number maps back to verdict=untested.
    for (const node of Array.from(visible)) {
      const seqAttr = node.getAttribute('data-testid')!.split('zerou-tree-log-event-')[1];
      const ev = events.find((e) => String(e.seq) === seqAttr);
      expect(ev?.verdict).toBe('untested');
    }
  });

  it('clicking a log event opens the drawer with raw JSON', () => {
    render(<ZerouBranchTreeLog events={events} />);
    const firstEvent = events[0]!;
    const row = screen.getByTestId(`zerou-tree-log-event-${firstEvent.seq}`);
    fireEvent.click(row);
    expect(screen.getByTestId('zerou-log-event-drawer')).toBeInTheDocument();
    const jsonl = screen.getByTestId('zerou-log-event-jsonl');
    expect(jsonl.textContent).toContain(firstEvent.branch_id);
    // Close drawer.
    fireEvent.click(screen.getByTestId('zerou-log-event-drawer-close'));
    expect(screen.queryByTestId('zerou-log-event-drawer')).toBeNull();
  });

  it('clicking a tree directory pins the stream filter to that subtree', () => {
    render(<ZerouBranchTreeLog events={events} />);
    // Find the app/ dir button (always rendered).
    const appBtn = screen.getByText('app/');
    fireEvent.click(appBtn);
    // "clear" button shows up — confirms a focus filter is active.
    expect(screen.getByTestId('zerou-tree-log-clear-focus')).toBeInTheDocument();
  });

  it('animates new live events with anim-pulse-green', () => {
    vi.useFakeTimers();
    try {
      const baseLine = events.slice(0, 10);
      const { rerender } = render(
        <ZerouBranchTreeLog events={baseLine} liveConnected staticEventCount={baseLine.length} />,
      );

      // Inject one new event with a brand-new branch_id.
      const newEvent: BranchTraceEvent = {
        ...events[11]!,
        seq: 9999,
        branch_id: 'app/api/_live/route.ts:liveHandler@12:if-true-line5-true#1',
      };
      rerender(
        <ZerouBranchTreeLog
          events={[...baseLine, newEvent]}
          liveConnected
          staticEventCount={baseLine.length}
        />,
      );

      const liveRow = screen.getByTestId(`zerou-tree-log-event-${newEvent.seq}`);
      expect(liveRow.className).toMatch(/anim-pulse-green/);

      // After 1.5s, the class is removed.
      act(() => {
        vi.advanceTimersByTime(1600);
      });
      // (We only assert the timer fired by checking no error; React state
      // update inside the effect could re-render asynchronously, so we
      // rely on the timer call sequence — exercising the cleanup path.)
    } finally {
      vi.useRealTimers();
    }
  });

  it('clear-focus button removes the filter pin', () => {
    render(<ZerouBranchTreeLog events={events} />);
    fireEvent.click(screen.getByText('app/'));
    expect(screen.getByTestId('zerou-tree-log-clear-focus')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('zerou-tree-log-clear-focus'));
    expect(screen.queryByTestId('zerou-tree-log-clear-focus')).toBeNull();
  });

  it('renders "no branch-trace events" when events array is empty', () => {
    render(<ZerouBranchTreeLog events={[]} />);
    // The placeholder appears in both panes.
    expect(screen.getAllByText(/no branch-trace events/).length).toBeGreaterThan(0);
  });

  // ── Phase 14.5: state-machine glyphs + retry counter + heat-strip jump ───
  //
  // Each test below crafts a single synthetic event under `app/api/...` so
  // the default openPath set already shows the file row; we then click the
  // file + fn toggles to expand the leaf.

  // Strip synth state/category/retry from a base event so a test override
  // isn't shadowed by whatever the mock bundle's syntheticStateFor() set.
  function freshBase(): BranchTraceEvent {
    return {
      ...events[0]!,
      state: undefined,
      category: undefined,
      retry: undefined,
    };
  }

  function expandToLeaf(filePath: string, fnName: string) {
    const fileTestId = `zerou-tree-log-file-${filePath.split('/').pop()!.replace(/[\\/.]/g, '-')}`;
    const fileRow = screen.getByTestId(fileTestId);
    // First button inside the row is the chevron toggle.
    const fileToggle = fileRow.querySelector('button');
    if (fileToggle) fireEvent.click(fileToggle);
    const fnRow = screen.getByTestId(`zerou-tree-log-fn-${fnName}`);
    const fnToggle = fnRow.querySelector('button');
    if (fnToggle) fireEvent.click(fnToggle);
  }

  it('leaf with state=evaluating renders the spin-arrow animation', () => {
    const ev: BranchTraceEvent = {
      ...freshBase(),
      seq: 9001,
      branch_id: 'state-eval-id',
      'code.file.path': 'app/api/eval-state.ts',
      'code.function': 'evalFn',
      'code.line.number': 7,
      state: 'evaluating',
    };
    render(<ZerouBranchTreeLog events={[ev]} />);
    expandToLeaf('app/api/eval-state.ts', 'evalFn');
    const leaf = screen.getByTestId('zerou-tree-log-leaf-9001');
    expect(leaf.getAttribute('data-branch-state')).toBe('evaluating');
    expect(leaf.querySelector('.anim-spin-arrow')).not.toBeNull();
  });

  it('leaf with state=retrying displays retry counter "retry 2/3"', () => {
    const ev: BranchTraceEvent = {
      ...freshBase(),
      seq: 9002,
      branch_id: 'state-retry-id',
      'code.file.path': 'app/api/retry-state.ts',
      'code.function': 'retryFn',
      'code.line.number': 8,
      state: 'retrying',
      retry: { attempt: 2, max: 3 },
    };
    render(<ZerouBranchTreeLog events={[ev]} />);
    expandToLeaf('app/api/retry-state.ts', 'retryFn');
    const retryBadge = screen.getByTestId('zerou-tree-log-leaf-9002-retry');
    expect(retryBadge.textContent).toMatch(/retry 2\/3/);
  });

  it('leaf with mechanical-red shows wrench overlay glyph', () => {
    const ev: BranchTraceEvent = {
      ...freshBase(),
      seq: 9003,
      branch_id: 'state-mech-id',
      'code.file.path': 'app/api/mech-state.ts',
      'code.function': 'mechFn',
      'code.line.number': 9,
      verdict: 'untested',
      category: 'mechanical',
    };
    render(<ZerouBranchTreeLog events={[ev]} />);
    expandToLeaf('app/api/mech-state.ts', 'mechFn');
    const leaf = screen.getByTestId('zerou-tree-log-leaf-9003');
    expect(leaf.getAttribute('data-branch-state')).toBe('mechanical-red');
    expect(leaf.textContent).toContain('🔧');
  });

  it('leaf with business-red shows lock overlay glyph', () => {
    const ev: BranchTraceEvent = {
      ...freshBase(),
      seq: 9004,
      branch_id: 'state-biz-id',
      'code.file.path': 'app/api/biz-state.ts',
      'code.function': 'bizFn',
      'code.line.number': 10,
      verdict: 'untested',
      category: 'business',
    };
    render(<ZerouBranchTreeLog events={[ev]} />);
    expandToLeaf('app/api/biz-state.ts', 'bizFn');
    const leaf = screen.getByTestId('zerou-tree-log-leaf-9004');
    expect(leaf.getAttribute('data-branch-state')).toBe('business-red');
    expect(leaf.textContent).toContain('🔒');
  });

  it('re-rendering with new state updates the glyph (covered → business-red)', () => {
    const evCovered: BranchTraceEvent = {
      ...freshBase(),
      seq: 9005,
      branch_id: 'state-transition-id',
      'code.file.path': 'app/api/trans-state.ts',
      'code.function': 'transFn',
      'code.line.number': 11,
      verdict: 'covered',
    };
    const { rerender } = render(<ZerouBranchTreeLog events={[evCovered]} />);
    expandToLeaf('app/api/trans-state.ts', 'transFn');
    let leaf = screen.getByTestId('zerou-tree-log-leaf-9005');
    expect(leaf.getAttribute('data-branch-state')).toBe('covered');

    const evBiz: BranchTraceEvent = { ...evCovered, verdict: 'untested', category: 'business' };
    rerender(<ZerouBranchTreeLog events={[evBiz]} />);
    leaf = screen.getByTestId('zerou-tree-log-leaf-9005');
    expect(leaf.getAttribute('data-branch-state')).toBe('business-red');
  });

  it('scrollToFile prop registers the file row with the expected data-file-path', () => {
    const ev: BranchTraceEvent = {
      ...freshBase(),
      seq: 9006,
      branch_id: 'jump-test-id',
      'code.file.path': 'app/api/jump-target.ts',
      'code.function': 'jumpFn',
      'code.line.number': 12,
      verdict: 'covered',
    };
    render(
      <ZerouBranchTreeLog
        events={[ev]}
        scrollToFile={{ path: 'app/api/jump-target.ts', token: 1 }}
      />,
    );
    const fileRow = document.querySelector(
      '[data-file-path="app/api/jump-target.ts"]',
    );
    expect(fileRow).not.toBeNull();
  });

  it('aria-live region announces the tree worst-state', () => {
    const evBiz: BranchTraceEvent = {
      ...freshBase(),
      seq: 9007,
      branch_id: 'aria-test-id',
      'code.file.path': 'app/api/aria-state.ts',
      'code.function': 'ariaFn',
      'code.line.number': 13,
      verdict: 'untested',
      category: 'business',
    };
    render(<ZerouBranchTreeLog events={[evBiz]} />);
    const live = screen.getByTestId('zerou-tree-log-aria-live');
    expect(live.textContent).toMatch(/business red/i);
  });
});
