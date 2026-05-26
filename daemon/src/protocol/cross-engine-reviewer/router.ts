/**
 * Cross-Engine Reviewer Protocol — Engine Family Router.
 *
 * Surface authority: docs/details/14-protocol-1-public-surface.md
 *
 * - `engineFamily(cfg)` — pure classification per surface §"Family taxonomy".
 * - `pickCriticEngine(worker, pool)` — selects critic engine per surface
 *   §"pickCriticEngine semantics".
 *
 * The original shim at `daemon/src/engines/router.ts` re-exports these for
 * backward compatibility (with the legacy single-engine-pool signature).
 */

import type { EngineConfig } from '../../config/types.js';
import type {
  CriticPolicy,
  MinimalCriticEngineSurface,
} from './types.js';

// ── Family classification ───────────────────────────────────────────────────

/**
 * Classify an `EngineConfig` into a "family" string. Two engines share a
 * family iff `engineFamily` returns the same string for both.
 *
 * - claude-cli, anthropic-api → 'anthropic'
 * - codex-cli → 'openai'
 * - gemini-cli → 'google'
 * - openai-compat → lowercase URL(baseUrl).hostname (no port, no path);
 *   invalid URL → 'openai-compat:unknown'
 */
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

// ── Critic-engine adapter ───────────────────────────────────────────────────
//
// `pickCriticEngine` returns a `MinimalCriticEngineSurface` instance. Real
// engines from `daemon/src/engines/*.ts` don't yet implement getMeta()/
// lastCallCostUsd(); they implement the older `LLMEngine` shape. Phase 3
// surfaces P1's narrow contract — and for production wiring, real engines
// will grow these methods.
//
// To unblock both real-engine wiring and test-mocked engines (which implement
// MinimalCriticEngineSurface directly), `pickCriticEngine` builds an adapter
// whose `getMeta()` returns the EngineConfig fields verbatim and whose
// `call()`/`lastCallCostUsd()` throw a deferred error until a real engine is
// wired. Test code SHOULD NOT exercise the adapter — tests patch
// `policy.criticEngine` to a MockEngine before calling reviewFinding /
// reviewBatch / proposeFix (per surface §"CriticPolicy construction" + tests
// doc §2 mocking strategy).

function buildPlaceholderAdapter(cfg: EngineConfig): MinimalCriticEngineSurface {
  // Mine metadata from EngineConfig. Per surface §"CriticInfo provenance":
  // these fields mirror the EngineConfig passed at engine construction time.
  const cfgAny = cfg as unknown as Record<string, unknown>;
  const modelId =
    typeof cfgAny.modelId === 'string' ? (cfgAny.modelId as string) : '';
  const releaseDate =
    typeof cfgAny.releaseDate === 'string' ? (cfgAny.releaseDate as string) : '';
  return {
    call(_prompt: string): Promise<string> {
      return Promise.reject(
        new Error(
          'P1 critic engine adapter not wired to real engine; tests must patch policy.criticEngine before invocation',
        ),
      );
    },
    lastCallCostUsd(): number | null {
      return null;
    },
    getMeta() {
      return { kind: cfg.kind, modelId, releaseDate };
    },
  };
}

// ── pickCriticEngine ────────────────────────────────────────────────────────

/**
 * Decide the critic engine. Per surface §"pickCriticEngine semantics":
 *
 * - Empty / undefined / null pool → no-critic-configured, critic === worker.
 * - First cross-family pool member wins (deterministic, callers control order).
 * - All-same-family pool → same-family-as-worker, critic = first pool entry.
 *
 * Each call returns a CriticPolicy whose `criticEngine` is a FRESH instance.
 * Engine instances are NOT pooled across calls — callers wanting shared
 * rate-limit accounting MUST reuse a CriticPolicy across reviewBatch/
 * reviewFinding calls (per surface §"Engine instance pooling").
 */
export function pickCriticEngine(
  worker: EngineConfig,
  pool?: EngineConfig[] | null,
): CriticPolicy {
  // Empty / undefined / null pool → no-critic-configured.
  if (!pool || pool.length === 0) {
    return {
      worker,
      critic: worker,
      criticEngine: buildPlaceholderAdapter(worker),
      crossFamily: false,
      reason: 'no-critic-configured',
    };
  }

  const workerFam = engineFamily(worker);

  // First cross-family pool member wins.
  for (const candidate of pool) {
    if (engineFamily(candidate) !== workerFam) {
      return {
        worker,
        critic: candidate,
        criticEngine: buildPlaceholderAdapter(candidate),
        crossFamily: true,
        reason: 'cross-family-active',
      };
    }
  }

  // All pool entries share family with worker → same-family-as-worker; first
  // pool entry is chosen (callers may treat this as a configuration warning).
  const critic = pool[0]!;
  return {
    worker,
    critic,
    criticEngine: buildPlaceholderAdapter(critic),
    crossFamily: false,
    reason: 'same-family-as-worker',
  };
}
