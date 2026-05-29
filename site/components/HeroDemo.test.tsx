/**
 * Tests for HeroDemo — 52-second phase machine + reduced-motion fallback.
 *
 * 7-phase order: problem → install → scan → fix → enhance → verify → bench.
 * Durations: 5 + 5 + 8 + 9 + 10 + 8 + 7 = 52 seconds.
 *
 * Uses vitest + @testing-library/react.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import HeroDemo, { PHASES, TOTAL_DURATION } from './HeroDemo';

// ---------------------------------------------------------------------------
// RAF + performance.now stubs so we can deterministically advance time.
// ---------------------------------------------------------------------------

let rafCallbacks: Array<{ id: number; cb: FrameRequestCallback }> = [];
let nextRafId = 1;
let mockNow = 0;

function flushFrame() {
  const due = rafCallbacks.slice();
  rafCallbacks = [];
  due.forEach(({ cb }) => cb(mockNow));
}

function advance(ms: number) {
  mockNow += ms;
  act(() => {
    flushFrame();
  });
}

beforeEach(() => {
  rafCallbacks = [];
  nextRafId = 1;
  mockNow = 0;

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextRafId++;
    rafCallbacks.push({ id, cb });
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafCallbacks = rafCallbacks.filter((r) => r.id !== id);
  });

  Object.defineProperty(global.performance, 'now', {
    configurable: true,
    value: () => mockNow,
  });

  // Default: motion allowed
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPhase(): string | null {
  return screen.getByTestId('hero-demo').getAttribute('data-phase');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HeroDemo', () => {
  it('renders without crashing and starts on the problem phase', () => {
    render(<HeroDemo />);
    advance(0);
    expect(getPhase()).toBe('problem');
    expect(screen.getByText(/vibe-coded demo/i)).toBeTruthy();
  });

  it('phase timings sum to exactly 52 seconds', () => {
    expect(TOTAL_DURATION).toBe(52000);
    expect(PHASES.map((p) => p.duration).reduce((a, b) => a + b, 0)).toBe(52000);
  });

  it('has 7 phases in the order: problem → install → scan → fix → enhance → verify → bench', () => {
    expect(PHASES.map((p) => p.id)).toEqual([
      'problem',
      'install',
      'scan',
      'fix',
      'enhance',
      'verify',
      'bench',
    ]);
  });

  it('uses the phase duration distribution [5000, 5000, 8000, 9000, 10000, 8000, 7000]', () => {
    expect(PHASES.map((p) => p.duration)).toEqual([5000, 5000, 8000, 9000, 10000, 8000, 7000]);
  });

  it('transitions to install phase after 5s', () => {
    render(<HeroDemo />);
    advance(0);
    expect(getPhase()).toBe('problem');
    advance(5100);
    expect(getPhase()).toBe('install');
  });

  it('cycles through all 7 phases in order over 52s', () => {
    render(<HeroDemo />);
    const order: string[] = [];
    advance(0);
    order.push(getPhase()!);

    let elapsed = 0;
    for (const spec of PHASES) {
      const middle = elapsed + spec.duration / 2;
      advance(middle - mockNow);
      order.push(getPhase()!);
      elapsed += spec.duration;
    }

    expect(order[1]).toBe('problem');
    expect(order[2]).toBe('install');
    expect(order[3]).toBe('scan');
    expect(order[4]).toBe('fix');
    expect(order[5]).toBe('enhance');
    expect(order[6]).toBe('verify');
    expect(order[7]).toBe('bench');
  });

  it('loops back to problem after 52s', () => {
    render(<HeroDemo />);
    advance(0);
    expect(getPhase()).toBe('problem');
    advance(51500);
    expect(getPhase()).toBe('bench');
    advance(1000); // crosses 52s boundary
    expect(getPhase()).toBe('problem');
  });

  it('updates captions as phase changes (aria-live region)', () => {
    render(<HeroDemo />);
    advance(0);
    expect(screen.getByText(/vibe-coded demo\. works locally/i)).toBeTruthy();

    advance(5500); // into install (~5.5s)
    expect(screen.getAllByText(/npm install -g zerou/i).length).toBeGreaterThan(0);

    advance(5000); // into scan (~10.5s)
    expect(screen.getByText(/scan: ast/i)).toBeTruthy();

    advance(8000); // into fix (~18.5s)
    expect(screen.getByText(/generate spec/i)).toBeTruthy();

    advance(9000); // into enhance (~27.5s)
    expect(screen.getByText(/each log knows where it came from/i)).toBeTruthy();

    advance(10000); // into verify (~37.5s)
    expect(screen.getByText(/install · tsc · test · build/i)).toBeTruthy();

    advance(8000); // into bench (~45.5s)
    expect(screen.getByText(/zerou vs frontier models/i)).toBeTruthy();
  });

  it('renders the bench phase with ZeroU + Opus + Sonnet model labels', () => {
    render(<HeroDemo />);
    // Advance to the middle of the bench phase (~48.5s in).
    advance(48500);
    expect(getPhase()).toBe('bench');
    // Allow staggered row reveal to settle by progress >= 0.5.
    expect(screen.getAllByText(/ZeroU/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Claude Opus/)).toBeTruthy();
    expect(screen.getByText(/Claude Sonnet/)).toBeTruthy();
  });

  it('shows a static final frame + Play button when prefers-reduced-motion is set', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query.includes('reduce'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });

    render(<HeroDemo />);
    advance(0);

    // Reduced-motion: pinned to the final ('bench') phase — the punchline frame.
    expect(getPhase()).toBe('bench');

    // Play button is rendered
    const playBtn = screen.getByTestId('hero-demo-play');
    expect(playBtn).toBeTruthy();
    expect(playBtn.textContent || '').toMatch(/play/i);

    // Time advancing does not change the phase while reduced-motion is honoured
    advance(10000);
    expect(getPhase()).toBe('bench');
  });

  it('renders the 7-stage PhaseTimeline with the current stage marked aria-current', () => {
    render(<HeroDemo />);
    advance(5500); // install (stage 2 of 7)
    const current = document.querySelector('[aria-current="step"]');
    expect(current).toBeTruthy();
    // Label inside the active segment is the uppercase stage name "Install".
    expect((current?.textContent || '').toUpperCase()).toMatch(/INSTALL/);
  });

  it('PhaseTimeline renders all 7 stage labels in uppercase section-title style', () => {
    render(<HeroDemo />);
    advance(0);
    // Each PHASES label appears at least once in the timeline strip.
    for (const spec of PHASES) {
      // The label is rendered with CSS `uppercase`. In jsdom this is text "Install"
      // styled to render uppercase; we just verify the literal label is present.
      expect(screen.getAllByText(spec.label).length).toBeGreaterThan(0);
    }
  });
});
