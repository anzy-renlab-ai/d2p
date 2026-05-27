import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { useReviewStream, type UseReviewStreamResult } from './useReviewStream.js';
import type { SSEHandle } from './sseClient.js';
import type { BranchTraceEvent } from '../types-zerou.js';

// ── Fake SSEHandle (the test seam) ────────────────────────────────────────

interface FakeHandle extends SSEHandle {
  emit(type: string, data: string, lastEventId?: string): void;
  fireError(): void;
  url: string;
  closed: boolean;
  initLastEventId?: string | number;
}

function makeFakeFactory() {
  const instances: FakeHandle[] = [];
  const factory = (url: string, init?: { lastEventId?: string | number }): SSEHandle => {
    const listeners = new Map<string, Array<(evt: { data: string; lastEventId?: string }) => void>>();
    const h: FakeHandle = {
      url,
      initLastEventId: init?.lastEventId,
      closed: false,
      readyState: 0,
      onerror: null,
      addEventListener(type, fn) {
        const arr = listeners.get(type) ?? [];
        arr.push(fn);
        listeners.set(type, arr);
      },
      removeEventListener(type, fn) {
        const arr = listeners.get(type);
        if (!arr) return;
        listeners.set(
          type,
          arr.filter((f) => f !== fn),
        );
      },
      close() {
        this.closed = true;
        (this as { readyState: 0 | 1 | 2 }).readyState = 2;
      },
      emit(type, data, lastEventId) {
        const arr = listeners.get(type) ?? [];
        for (const fn of arr) fn({ data, lastEventId });
      },
      fireError() {
        this.onerror?.(new Event('error'));
      },
    };
    instances.push(h);
    return h;
  };
  return { factory, instances };
}

// ── Probe component — exposes the hook result to tests via callback ───────

function Probe({
  opts,
  onResult,
}: {
  opts: Parameters<typeof useReviewStream>[0];
  onResult: (r: UseReviewStreamResult) => void;
}) {
  const r = useReviewStream(opts);
  useEffect(() => {
    onResult(r);
  });
  return null;
}

function makeBranchEvent(seq: number, overrides: Partial<BranchTraceEvent> = {}): BranchTraceEvent {
  return {
    ts: `2026-05-27T00:00:${String(seq).padStart(2, '0')}Z`,
    trace_id: 'tr-1',
    event: 'branch.evidence',
    branch_id: `b-${seq}`,
    branch_kind: 'if',
    branch_label: `branch ${seq}`,
    line_start: seq,
    line_end: seq + 1,
    'code.function': 'fnA',
    'code.file.path': 'src/x.ts',
    'code.line.number': seq,
    signals: { ast: true, spec: false, judge: false, run: null },
    verdict: 'unknown',
    evidence: { spec_ids: [] },
    seq,
    prev_hash: 'p',
    hash: 'h',
    ...overrides,
  };
}

describe('useReviewStream', () => {
  let lastResult: UseReviewStreamResult | null = null;
  const captureResult = (r: UseReviewStreamResult) => {
    lastResult = r;
  };

  beforeEach(() => {
    lastResult = null;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns status="disabled" when enabled=false', () => {
    render(<Probe opts={{ enabled: false }} onResult={captureResult} />);
    expect(lastResult?.status).toBe('disabled');
    expect(lastResult?.events).toEqual([]);
    expect(lastResult?.logEvents).toEqual([]);
  });

  it('transitions idle → connecting → streaming on first event', () => {
    const { factory, instances } = makeFakeFactory();
    render(<Probe opts={{ factory, enabled: true }} onResult={captureResult} />);
    // The first effect already ran connect() — status should be 'connecting'.
    expect(lastResult?.status).toBe('connecting');
    expect(instances.length).toBeGreaterThanOrEqual(1);

    act(() => {
      instances[instances.length - 1]!.emit('heartbeat', '{"ts":"2026-05-27T00:00:00Z"}');
    });
    expect(lastResult?.status).toBe('streaming');
    expect(lastResult?.connected).toBe(true);
    expect(lastResult?.lastEventTs).toBe('2026-05-27T00:00:00Z');
  });

  it('branch-trace.append events grow the events array', () => {
    const { factory, instances } = makeFakeFactory();
    render(<Probe opts={{ factory }} onResult={captureResult} />);
    const inst = instances[instances.length - 1]!;
    act(() => {
      inst.emit('branch-trace.append', JSON.stringify(makeBranchEvent(1)));
      inst.emit('branch-trace.append', JSON.stringify(makeBranchEvent(2)));
    });
    expect(lastResult?.events.length).toBe(2);
    expect(lastResult?.events[0]!.seq).toBe(1);
    expect(lastResult?.events[1]!.seq).toBe(2);
    expect(lastResult?.totalReceived).toBe(2);
  });

  it('log.append events grow the logEvents array', () => {
    const { factory, instances } = makeFakeFactory();
    render(<Probe opts={{ factory }} onResult={captureResult} />);
    act(() => {
      instances[0]!.emit(
        'log.append',
        JSON.stringify({ track: 'static', event: 'stage.start', ts: '2026-05-27T00:01:00Z', seq: 3 }),
      );
    });
    expect(lastResult?.logEvents.length).toBe(1);
    expect(lastResult?.logEvents[0]!.track).toBe('static');
    expect(lastResult?.logEvents[0]!.event).toBe('stage.start');
  });

  it('bundle.refresh sets bundleStale; clearBundleStale resets it', () => {
    const { factory, instances } = makeFakeFactory();
    render(<Probe opts={{ factory }} onResult={captureResult} />);
    act(() => {
      instances[0]!.emit('bundle.refresh', '{"reason":"finding-added"}');
    });
    expect(lastResult?.bundleStale).toBe(true);
    act(() => {
      lastResult!.clearBundleStale();
    });
    expect(lastResult?.bundleStale).toBe(false);
  });

  it('heartbeat resets retryCount and updates lastEventTs', () => {
    const { factory, instances } = makeFakeFactory();
    render(<Probe opts={{ factory }} onResult={captureResult} />);
    // Force a reconnect cycle first to bump retry counter.
    act(() => {
      instances[0]!.fireError();
      vi.advanceTimersByTime(2000);
    });
    expect(lastResult?.retryCount).toBeGreaterThan(0);
    // New instance opened on retry — emit heartbeat on it.
    act(() => {
      instances[instances.length - 1]!.emit('heartbeat', '{"ts":"2026-05-27T00:05:00Z"}');
    });
    expect(lastResult?.retryCount).toBe(0);
    expect(lastResult?.lastEventTs).toBe('2026-05-27T00:05:00Z');
  });

  it('error triggers reconnect with exponential backoff', () => {
    const { factory, instances } = makeFakeFactory();
    render(
      <Probe
        opts={{ factory, baseBackoffMs: 100, maxRetries: 5 }}
        onResult={captureResult}
      />,
    );
    const startCount = instances.length;
    act(() => {
      instances[0]!.fireError();
    });
    expect(lastResult?.status).toBe('reconnecting');
    // Backoff jittered between 75ms-125ms; advance well past the cap.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(instances.length).toBe(startCount + 1);
  });

  it('attaches lastEventId from last seen seq on reconnect', () => {
    const { factory, instances } = makeFakeFactory();
    render(<Probe opts={{ factory, baseBackoffMs: 50 }} onResult={captureResult} />);
    const first = instances[0]!;
    act(() => {
      first.emit('branch-trace.append', JSON.stringify(makeBranchEvent(42)));
    });
    expect(first.initLastEventId).toBeUndefined();
    act(() => {
      first.fireError();
      vi.advanceTimersByTime(150);
    });
    const second = instances[instances.length - 1]!;
    expect(second.initLastEventId).toBe(42);
  });

  it('maxEvents trims older entries', () => {
    const { factory, instances } = makeFakeFactory();
    render(<Probe opts={{ factory, maxEvents: 3 }} onResult={captureResult} />);
    act(() => {
      for (let i = 1; i <= 5; i++) {
        instances[0]!.emit('branch-trace.append', JSON.stringify(makeBranchEvent(i)));
      }
    });
    expect(lastResult?.events.length).toBe(3);
    expect(lastResult?.events[0]!.seq).toBe(3);
    expect(lastResult?.events[2]!.seq).toBe(5);
    expect(lastResult?.totalReceived).toBe(5);
  });

  it('disconnect() stops listening; further events are ignored', () => {
    const { factory, instances } = makeFakeFactory();
    render(<Probe opts={{ factory }} onResult={captureResult} />);
    act(() => {
      instances[0]!.emit('branch-trace.append', JSON.stringify(makeBranchEvent(1)));
    });
    expect(lastResult?.events.length).toBe(1);
    act(() => {
      lastResult!.disconnect();
    });
    expect(instances[0]!.closed).toBe(true);
    act(() => {
      // Even if we emit, the closed handle isn't wired anymore.
      instances[0]!.emit('branch-trace.append', JSON.stringify(makeBranchEvent(2)));
    });
    expect(lastResult?.events.length).toBe(1);
    expect(lastResult?.status).toBe('idle');
  });

  it('reconnect() opens a fresh connection after error', () => {
    const { factory, instances } = makeFakeFactory();
    render(
      <Probe
        opts={{ factory, baseBackoffMs: 50, maxRetries: 0 }}
        onResult={captureResult}
      />,
    );
    act(() => {
      instances[0]!.fireError();
    });
    // maxRetries=0 → straight to 'error'
    expect(lastResult?.status).toBe('error');
    const before = instances.length;
    act(() => {
      lastResult!.reconnect();
    });
    expect(instances.length).toBe(before + 1);
    expect(lastResult?.retryCount).toBe(0);
  });

  it('cleans up on unmount (closes handle, no leaks)', () => {
    const { factory, instances } = makeFakeFactory();
    const { unmount } = render(<Probe opts={{ factory }} onResult={captureResult} />);
    expect(instances[0]!.closed).toBe(false);
    unmount();
    // All opened handles should be closed after unmount.
    for (const inst of instances) {
      expect(inst.closed).toBe(true);
    }
  });

  it('stops retrying after maxRetries exceeded → status=error', () => {
    const { factory, instances } = makeFakeFactory();
    render(
      <Probe
        opts={{ factory, baseBackoffMs: 10, maxRetries: 2 }}
        onResult={captureResult}
      />,
    );
    act(() => {
      instances[0]!.fireError();
      vi.advanceTimersByTime(50);
      instances[instances.length - 1]!.fireError();
      vi.advanceTimersByTime(50);
      instances[instances.length - 1]!.fireError();
      vi.advanceTimersByTime(200);
    });
    expect(lastResult?.status).toBe('error');
  });

  it('refuses to connect to non-loopback URL (security)', () => {
    // Don't pass factory — use the real createSSEClient which gates.
    render(
      <Probe
        opts={{ url: 'https://evil.example.com/api/stream' }}
        onResult={captureResult}
      />,
    );
    // Sets status='error' synchronously; no events flow.
    expect(lastResult?.status).toBe('error');
    expect(lastResult?.events).toEqual([]);
  });
});
