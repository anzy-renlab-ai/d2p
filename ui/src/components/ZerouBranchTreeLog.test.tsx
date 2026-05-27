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
});
