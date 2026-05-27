import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZerouLogEventDrawer } from './ZerouLogEventDrawer.js';
import { mockZerouBundle } from '../mock/zerouBundle.js';

const events = mockZerouBundle.branchTraceEvents!;

describe('ZerouLogEventDrawer', () => {
  it('renders verdict + branch_id + raw JSON for the event', () => {
    const ev = events[0]!;
    render(<ZerouLogEventDrawer event={ev} onClose={() => {}} />);
    expect(screen.getByText(ev.verdict)).toBeInTheDocument();
    expect(screen.getByText(ev.branch_id)).toBeInTheDocument();
    const jsonl = screen.getByTestId('zerou-log-event-jsonl');
    expect(jsonl.textContent).toContain(ev.hash);
  });

  it('shows hash-chain neighbours when provided', () => {
    const ev = events[2]!;
    const prev = events[1]!;
    const next = events[3]!;
    render(
      <ZerouLogEventDrawer event={ev} prevEvent={prev} nextEvent={next} onClose={() => {}} />,
    );
    expect(screen.getByText(`#${prev.seq}`)).toBeInTheDocument();
    expect(screen.getByText(`#${next.seq}`)).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<ZerouLogEventDrawer event={events[0]!} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('zerou-log-event-drawer-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
