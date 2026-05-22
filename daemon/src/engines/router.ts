// F1 — cross-engine critic router.
//
// d2p's pitch leans on the 4-layer reviewer pipeline as the substitute for
// human diff review. That trust hollows out when the actor and the critic
// share the same model family (OpenHands' Critic Model paper, arXiv 2407.16741,
// showed measurable bias-decorrelation gains when the critic is a different
// provider). Pattern: the SAME engine reviewing its own output converges on
// the same blind spots — Devin's documented "fixates on irrelevant root cause"
// failures share this signature.
//
// This module classifies engine "families" and picks a critic engine that's
// guaranteed-different (or flags the session as cross-family-OFF if no second
// engine is configured).

import type { EngineConfig } from '../config/types.js';
import type { ClaudeRole } from '../types.js';

/** Roles where d2p wants the critic engine, not the worker. */
export const CRITIC_ROLES: ReadonlySet<ClaudeRole> = new Set<ClaudeRole>([
  'alignment',
  'behavioral',
  'adversarial',
  'done-check',
]);

/** Classify an engine config into a "family" — used for decorrelation checks.
 *  claude-cli and anthropic-api both call Anthropic-trained models so they
 *  count as one family ("anthropic"). openai-compat's family is the host name
 *  of its baseUrl, so api.minimaxi.chat and api.deepseek.com are distinct. */
export function engineFamily(cfg: EngineConfig): string {
  if (cfg.kind === 'claude-cli' || cfg.kind === 'anthropic-api') return 'anthropic';
  if (cfg.kind === 'codex-cli') return 'openai';
  if (cfg.kind === 'gemini-cli') return 'google';
  if (cfg.kind === 'openai-compat') {
    try {
      return new URL(cfg.baseUrl).hostname.toLowerCase();
    } catch {
      return 'openai-compat:unknown';
    }
  }
  // exhaustiveness — should never reach
  return 'unknown';
}

export interface CriticPolicy {
  /** The engine config the critic should run on. Equal to worker when no
   *  second engine is configured (degraded mode). */
  critic: EngineConfig;
  /** True iff critic family differs from worker family. */
  crossFamily: boolean;
  /** Why crossFamily is false — useful for the UI badge. */
  reason: 'cross-family-active' | 'no-critic-configured' | 'same-family-as-worker';
}

/** Decide the critic engine. If `criticPool` contains an engine of a different
 *  family from `worker`, pick that. Otherwise degrade to the worker itself and
 *  flag the session. */
export function pickCriticEngine(worker: EngineConfig, criticPool?: EngineConfig | null): CriticPolicy {
  if (!criticPool) {
    return { critic: worker, crossFamily: false, reason: 'no-critic-configured' };
  }
  const workerFam = engineFamily(worker);
  const criticFam = engineFamily(criticPool);
  if (workerFam !== criticFam) {
    return { critic: criticPool, crossFamily: true, reason: 'cross-family-active' };
  }
  return { critic: criticPool, crossFamily: false, reason: 'same-family-as-worker' };
}

/** Compact short-name for engine families — used in UI badges. */
export function engineFamilyLabel(family: string): string {
  if (family === 'anthropic') return 'anthropic';
  // host-derived: strip subdomain noise for readability
  const parts = family.split('.');
  if (parts.length >= 2) return parts.slice(-2).join('.');
  return family;
}
