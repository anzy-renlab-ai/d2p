import { describe, it, expect } from 'vitest';
import {
  assertSessionTransition,
  assertGapTransition,
  assertFixTransition,
  IllegalTransitionError,
} from './transitions.js';

describe('session transitions', () => {
  it('allows SETUP -> LOOPING', () => {
    expect(() => assertSessionTransition('SETUP', 'LOOPING')).not.toThrow();
  });
  it('forbids LOOPING -> SETUP', () => {
    expect(() => assertSessionTransition('LOOPING', 'SETUP')).toThrow(IllegalTransitionError);
  });
  it('allows LOOPING -> PAUSED -> LOOPING', () => {
    expect(() => assertSessionTransition('LOOPING', 'PAUSED')).not.toThrow();
    expect(() => assertSessionTransition('PAUSED', 'LOOPING')).not.toThrow();
  });
  it('allows self-transition (idempotent)', () => {
    expect(() => assertSessionTransition('LOOPING', 'LOOPING')).not.toThrow();
  });
});

describe('gap transitions', () => {
  it('allows PENDING -> IN_PROGRESS', () => {
    expect(() => assertGapTransition('PENDING', 'IN_PROGRESS')).not.toThrow();
  });
  it('allows IN_PROGRESS -> DONE', () => {
    expect(() => assertGapTransition('IN_PROGRESS', 'DONE')).not.toThrow();
  });
  it('forbids DONE -> IN_PROGRESS (terminal)', () => {
    expect(() => assertGapTransition('DONE', 'IN_PROGRESS')).toThrow(IllegalTransitionError);
  });
  it('forbids PENDING -> DONE (must go through IN_PROGRESS)', () => {
    expect(() => assertGapTransition('PENDING', 'DONE')).toThrow(IllegalTransitionError);
  });
});

describe('fix transitions', () => {
  it('happy path STARTED -> IMPLEMENTING -> ... -> MERGED', () => {
    expect(() => assertFixTransition('STARTED', 'IMPLEMENTING')).not.toThrow();
    expect(() => assertFixTransition('IMPLEMENTING', 'STATIC_GATE_RUNNING')).not.toThrow();
    expect(() => assertFixTransition('STATIC_GATE_RUNNING', 'ALIGNMENT_RUNNING')).not.toThrow();
    expect(() => assertFixTransition('ALIGNMENT_RUNNING', 'BEHAVIORAL_RUNNING')).not.toThrow();
    expect(() => assertFixTransition('BEHAVIORAL_RUNNING', 'MERGED')).not.toThrow();
  });
  it('failure path lands in DROPPED', () => {
    expect(() => assertFixTransition('STATIC_GATE_RUNNING', 'STATIC_GATE_FAILED')).not.toThrow();
    expect(() => assertFixTransition('STATIC_GATE_FAILED', 'DROPPED')).not.toThrow();
  });
  it('forbids skipping straight to MERGED', () => {
    expect(() => assertFixTransition('STARTED', 'MERGED')).toThrow(IllegalTransitionError);
  });
});
