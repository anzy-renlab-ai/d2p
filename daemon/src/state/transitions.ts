// State machine transition tables. Detail: docs/details/06-state-machines.md.

import type { SessionStatus, GapStatus, FixStatus } from '../types.js';

export class IllegalTransitionError extends Error {
  constructor(table: string, from: string, to: string) {
    super(`illegal ${table} transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

const SESSION: Record<SessionStatus, SessionStatus[]> = {
  SETUP: ['LOOPING', 'ENDED'],
  LOOPING: ['PAUSED', 'DONE', 'ENDED'],
  PAUSED: ['LOOPING', 'ENDED'],
  DONE: ['ENDED'],
  ENDED: [],
};

const GAP: Record<GapStatus, GapStatus[]> = {
  PENDING: ['IN_PROGRESS', 'SKIPPED'],
  IN_PROGRESS: ['DONE', 'NEED_HUMAN', 'SKIPPED', 'SPLIT_DONE'],
  DONE: [],
  SKIPPED: [],
  NEED_HUMAN: [],
  SPLIT_DONE: [],
};

const FIX: Record<FixStatus, FixStatus[]> = {
  STARTED: ['IMPLEMENTING', 'DROPPED'],
  IMPLEMENTING: ['STATIC_GATE_RUNNING', 'DROPPED'],
  STATIC_GATE_RUNNING: ['ALIGNMENT_RUNNING', 'STATIC_GATE_FAILED'],
  STATIC_GATE_FAILED: ['DROPPED'],
  ALIGNMENT_RUNNING: ['BEHAVIORAL_RUNNING', 'ALIGNMENT_FAILED'],
  ALIGNMENT_FAILED: ['DROPPED'],
  BEHAVIORAL_RUNNING: ['ADVERSARIAL_RUNNING', 'MERGED', 'BEHAVIORAL_FAILED'],
  BEHAVIORAL_FAILED: ['DROPPED'],
  ADVERSARIAL_RUNNING: ['MERGED', 'ADVERSARIAL_FAILED'],
  ADVERSARIAL_FAILED: ['DROPPED'],
  MERGED: [],
  DROPPED: [],
};

export function assertSessionTransition(from: SessionStatus, to: SessionStatus): void {
  if (from === to) return;
  if (!SESSION[from].includes(to)) {
    throw new IllegalTransitionError('session', from, to);
  }
}

export function assertGapTransition(from: GapStatus, to: GapStatus): void {
  if (from === to) return;
  if (!GAP[from].includes(to)) {
    throw new IllegalTransitionError('gap', from, to);
  }
}

export function assertFixTransition(from: FixStatus, to: FixStatus): void {
  if (from === to) return;
  if (!FIX[from].includes(to)) {
    throw new IllegalTransitionError('fix', from, to);
  }
}

export const TRANSITIONS = { SESSION, GAP, FIX } as const;
