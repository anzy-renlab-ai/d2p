import { describe, it, expect } from 'vitest';
import {
  analyzeEvents,
  detectFixation,
  detectThrash,
  detectCriticBias,
  detectRunawayCost,
  DEFAULT_THRESHOLDS,
  type AnalyzedEvent,
} from './pathology.js';
import type { LogEventKind } from '../types.js';

function ev(kind: LogEventKind, payload: Record<string, unknown> = {}, tsOffset = 0): AnalyzedEvent {
  return { kind, payload, ts: Date.now() - tsOffset };
}

describe('detectFixation', () => {
  it('fires when same slug has 3 consecutive failed attempts', () => {
    const stream: AnalyzedEvent[] = [
      ev('GAP_PICKED', { slug: 'foo' }),
      ev('STATIC_GATE_FAILED', { slug: 'foo' }),
      ev('GAP_PICKED', { slug: 'foo' }),
      ev('REVIEW_VERDICT', { verdict: 'REJECT' }),
      ev('GAP_PICKED', { slug: 'foo' }),
      ev('REVIEW_VERDICT', { verdict: 'REJECT' }),
    ];
    const p = detectFixation(stream, DEFAULT_THRESHOLDS);
    expect(p).not.toBeNull();
    expect(p?.kind).toBe('fixation');
    expect(p?.detail).toContain('foo');
  });

  it('clears after MERGED', () => {
    const stream: AnalyzedEvent[] = [
      ev('GAP_PICKED', { slug: 'foo' }),
      ev('STATIC_GATE_FAILED'),
      ev('STATIC_GATE_FAILED'),
      ev('STATIC_GATE_FAILED'),
      ev('MERGED'),
    ];
    expect(detectFixation(stream, DEFAULT_THRESHOLDS)).toBeNull();
  });

  it('does NOT fire on different slugs', () => {
    const stream: AnalyzedEvent[] = [
      ev('GAP_PICKED', { slug: 'foo' }),
      ev('STATIC_GATE_FAILED'),
      ev('GAP_PICKED', { slug: 'bar' }),
      ev('STATIC_GATE_FAILED'),
      ev('GAP_PICKED', { slug: 'baz' }),
      ev('STATIC_GATE_FAILED'),
    ];
    expect(detectFixation(stream, DEFAULT_THRESHOLDS)).toBeNull();
  });
});

describe('detectThrash', () => {
  it('fires when revert rate exceeds threshold in window', () => {
    const now = Date.now();
    const stream: AnalyzedEvent[] = [
      ev('MERGED', {}, 60_000),
      ev('FIX_DROPPED', {}, 30_000),
      ev('FIX_DROPPED', {}, 10_000),
      ev('FIX_DROPPED', {}, 5_000),
    ];
    const p = detectThrash(stream, DEFAULT_THRESHOLDS, now);
    expect(p).not.toBeNull();
    expect(p?.kind).toBe('thrash');
  });

  it('does NOT fire when nothing happened in window', () => {
    const now = Date.now();
    expect(detectThrash([], DEFAULT_THRESHOLDS, now)).toBeNull();
  });

  it('does NOT fire when reverts/total below threshold', () => {
    const now = Date.now();
    const stream: AnalyzedEvent[] = [
      ev('MERGED', {}, 60_000),
      ev('MERGED', {}, 50_000),
      ev('MERGED', {}, 40_000),
      ev('FIX_DROPPED', {}, 30_000),
    ];
    expect(detectThrash(stream, DEFAULT_THRESHOLDS, now)).toBeNull();
  });
});

describe('detectCriticBias', () => {
  it('fires when reviewer agreement is too low', () => {
    const stream: AnalyzedEvent[] = [
      ev('REVIEW_VERDICT', { verdict: 'REJECT' }),
      ev('REVIEW_VERDICT', { verdict: 'REJECT' }),
      ev('REVIEW_VERDICT', { verdict: 'REJECT' }),
      ev('REVIEW_VERDICT', { verdict: 'REJECT' }),
      ev('REVIEW_VERDICT', { verdict: 'REJECT' }),
    ];
    const p = detectCriticBias(stream, DEFAULT_THRESHOLDS);
    expect(p?.kind).toBe('critic-bias');
    expect(p?.level).toBe('crit'); // 0.0 agreement < 0.3
  });

  it('needs minimum sample size', () => {
    const stream: AnalyzedEvent[] = [
      ev('REVIEW_VERDICT', { verdict: 'REJECT' }),
      ev('REVIEW_VERDICT', { verdict: 'REJECT' }),
    ];
    expect(detectCriticBias(stream, DEFAULT_THRESHOLDS)).toBeNull();
  });

  it('does NOT fire on healthy agreement', () => {
    const stream: AnalyzedEvent[] = [
      ev('REVIEW_VERDICT', { verdict: 'APPROVE' }),
      ev('REVIEW_VERDICT', { verdict: 'APPROVE' }),
      ev('REVIEW_VERDICT', { verdict: 'APPROVE' }),
      ev('REVIEW_VERDICT', { verdict: 'APPROVE' }),
      ev('REVIEW_VERDICT', { verdict: 'REJECT' }),
    ];
    expect(detectCriticBias(stream, DEFAULT_THRESHOLDS)).toBeNull();
  });
});

describe('detectRunawayCost', () => {
  it('fires when spend rate exceeds threshold', () => {
    const now = Date.now();
    const stream: AnalyzedEvent[] = [
      ev('AGENT_END', { estimatedUsd: 1.0 }, 60_000),
      ev('AGENT_END', { estimatedUsd: 1.0 }, 30_000),
      ev('AGENT_END', { estimatedUsd: 1.0 }, 10_000),
    ];
    const p = detectRunawayCost(stream, DEFAULT_THRESHOLDS, now);
    expect(p?.kind).toBe('runaway-cost');
  });

  it('does NOT fire on modest spend', () => {
    const now = Date.now();
    const stream: AnalyzedEvent[] = [
      ev('AGENT_END', { estimatedUsd: 0.01 }, 60_000),
      ev('AGENT_END', { estimatedUsd: 0.01 }, 30_000),
    ];
    expect(detectRunawayCost(stream, DEFAULT_THRESHOLDS, now)).toBeNull();
  });
});

describe('analyzeEvents (composite)', () => {
  it('returns multiple pathologies when several fire', () => {
    const now = Date.now();
    const stream: AnalyzedEvent[] = [
      // Fixation
      ev('GAP_PICKED', { slug: 'x' }, 100),
      ev('STATIC_GATE_FAILED', {}, 90),
      ev('STATIC_GATE_FAILED', {}, 80),
      ev('STATIC_GATE_FAILED', {}, 70),
      // Plus critic-bias (5 rejects)
      ev('REVIEW_VERDICT', { verdict: 'REJECT' }),
      ev('REVIEW_VERDICT', { verdict: 'REJECT' }),
      ev('REVIEW_VERDICT', { verdict: 'REJECT' }),
      ev('REVIEW_VERDICT', { verdict: 'REJECT' }),
      ev('REVIEW_VERDICT', { verdict: 'REJECT' }),
    ];
    const out = analyzeEvents(stream, DEFAULT_THRESHOLDS, now);
    const kinds = out.map((p) => p.kind).sort();
    expect(kinds).toContain('fixation');
    expect(kinds).toContain('critic-bias');
  });

  it('returns empty for a healthy session', () => {
    const now = Date.now();
    const stream: AnalyzedEvent[] = [
      ev('GAP_PICKED', { slug: 'a' }, 60_000),
      ev('FIX_COMMITTED', {}, 50_000),
      ev('STATIC_GATE_PASSED', {}, 40_000),
      ev('REVIEW_VERDICT', { verdict: 'APPROVE' }, 30_000),
      ev('MERGED', {}, 20_000),
      ev('GAP_DONE', { slug: 'a' }, 10_000),
    ];
    expect(analyzeEvents(stream, DEFAULT_THRESHOLDS, now)).toEqual([]);
  });
});
