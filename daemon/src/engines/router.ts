// F1 — cross-engine critic router.
//
// Phase 3 (Track P1) MOVED `engineFamily` and `pickCriticEngine` to
// `daemon/src/protocol/cross-engine-reviewer/router.ts`. This file is now a
// thin backward-compatibility shim:
//
// - `engineFamily` re-exports verbatim from the new location.
// - `pickCriticEngine` here keeps the LEGACY single-engine-pool signature
//   `(worker, criticPool?: EngineConfig | null)` so daemon/src/engines/
//   registry.ts and old tests keep working. Internally it adapts to the new
//   `EngineConfig[]` array signature.
//
// New code under `daemon/src/protocol/cross-engine-reviewer/` MUST import
// from the new path. Engine-family classification semantics are unchanged.
//
// The reviewer pipeline rationale (OpenHands' Critic Model paper, Devin's
// blind-spot patterns) lives in the new module's header comment.

import type { EngineConfig } from '../config/types.js';
import type { ClaudeRole } from '../types.js';
import {
  engineFamily as _engineFamily,
  pickCriticEngine as _pickCriticEngineArray,
} from '../protocol/cross-engine-reviewer/router.js';
import type { CriticPolicy as ProtocolCriticPolicy } from '../protocol/cross-engine-reviewer/types.js';

export { _engineFamily as engineFamily };

/** Roles where d2p wants the critic engine, not the worker. */
export const CRITIC_ROLES: ReadonlySet<ClaudeRole> = new Set<ClaudeRole>([
  'alignment',
  'behavioral',
  'adversarial',
  'done-check',
]);

/**
 * Legacy critic policy shape (single-engine pool). The new Protocol-1 shape
 * lives at `daemon/src/protocol/cross-engine-reviewer/types.ts`.
 */
export interface CriticPolicy {
  critic: EngineConfig;
  crossFamily: boolean;
  reason: 'cross-family-active' | 'no-critic-configured' | 'same-family-as-worker';
}

/**
 * Backward-compatible wrapper around the new array-form `pickCriticEngine`.
 * Returns the legacy single-engine shape so daemon registry.ts and old unit
 * tests don't need to be rewritten.
 */
export function pickCriticEngine(
  worker: EngineConfig,
  criticPool?: EngineConfig | null,
): CriticPolicy {
  const arrPool = criticPool ? [criticPool] : null;
  const policy: ProtocolCriticPolicy = _pickCriticEngineArray(worker, arrPool);
  return {
    critic: policy.critic,
    crossFamily: policy.crossFamily,
    reason: policy.reason,
  };
}

/** Compact short-name for engine families — used in UI badges. */
export function engineFamilyLabel(family: string): string {
  if (family === 'anthropic') return 'anthropic';
  // host-derived: strip subdomain noise for readability
  const parts = family.split('.');
  if (parts.length >= 2) return parts.slice(-2).join('.');
  return family;
}
