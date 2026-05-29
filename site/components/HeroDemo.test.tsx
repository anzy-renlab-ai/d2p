/**
 * Tests for HeroDemo — 30-second phase machine + reduced-motion fallback.
 *
 * Uses vitest + @testing-library/react. If Worker A wires a different runner,
 * the imports may need adjusting (the assertions themselves are framework
 * neutral and use plain DOM queries via screen).
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
  // One frame is enough — the component reads `performance.now()` each call.
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

  // performance.now returns our mock clock
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
    // First frame after mount
    advance(0);
    expect(getPhase()).toBe('problem');
    expect(screen.getByText(/your vibe-coded demo/i)).toBeTruthy();
  });

  it('phase timings sum to exactly 30 seconds', () => {
    expect(TOTAL_DURATION).toBe(30000);
    expect(PHASES.map((p) => p.duration).reduce((a, b) => a + b, 0)).toBe(30000);
  });

  it('transitions to scan phase after 3s', () => {
    render(<HeroDemo />);
    advance(0);
    expect(getPhase()).toBe('problem');
    advance(3100);
    expect(getPhase()).toBe('scan');
  });

  it('cycles through all 6 phases in order over 30s', () => {
    render(<HeroDemo />);
    const order: string[] = [];
    advance(0);
    order.push(getPhase()!);

    // Sample at the middle of each phase
    let elapsed = 0;
    for (const spec of PHASES) {
      const middle = elapsed + spec.duration / 2;
      advance(middle - mockNow);
      order.push(getPhase()!);
      elapsed += spec.duration;
    }

    expect(order[1]).toBe('problem');
    expect(order[2]).toBe('scan');
    expect(order[3]).toBe('test');
    expect(order[4]).toBe('enhance');
    expect(order[5]).toBe('verify');
    expect(order[6]).toBe('proof');
  });

  it('loops back to problem after 30s', () => {
    render(<HeroDemo />);
    advance(0);
    expect(getPhase()).toBe('problem');
    advance(29500);
    expect(getPhase()).toBe('proof');
    advance(1000); // crosses 30s boundary
    expect(getPhase()).toBe('problem');
  });

  it('updates captions as phase changes (aria-live region)', () => {
    render(<HeroDemo />);
    advance(0);
    expect(screen.getByText(/your vibe-coded demo/i)).toBeTruthy();

    advance(3500); // into scan
    expect(screen.getByText(/stage 1 of 5/i)).toBeTruthy();

    advance(5000); // into test (~8.5s)
    expect(screen.getByText(/llm-judge finds 11 bugs/i)).toBeTruthy();
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

    // Reduced-motion: pinned to the final ('proof') phase
    expect(getPhase()).toBe('proof');

    // Play button is rendered
    const playBtn = screen.getByTestId('hero-demo-play');
    expect(playBtn).toBeTruthy();
    expect(playBtn.textContent || '').toMatch(/play/i);

    // Time advancing does not change the phase while reduced-motion is honoured
    advance(10000);
    expect(getPhase()).toBe('proof');
  });

  it('renders the 5-stage indicator with the current stage marked aria-current', () => {
    render(<HeroDemo />);
    advance(3500); // scan
    const current = document.querySelector('[aria-current="step"]');
    expect(current).toBeTruthy();
    // The active chip should contain the stage number for scan (stage 1 of 5)
    expect((current?.textContent || '').trim().startsWith('1')).toBe(true);
  });
});
