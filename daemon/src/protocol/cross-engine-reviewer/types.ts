/**
 * Cross-Engine Reviewer Protocol — Public Types.
 *
 * Surface authority: docs/details/14-protocol-1-public-surface.md
 *
 * This file is the canonical home for Protocol-1 types. Other modules import
 * from here (and the protocol entry-point modules in this directory).
 */

import type { EngineConfig } from '../../config/types.js';

// ── Surface version ─────────────────────────────────────────────────────────

export const REVIEWER_PROTOCOL_VERSION = '1.0' as const;

// ── Verdict + critic metadata ───────────────────────────────────────────────

export type Verdict =
  | 'confirmed'
  | 'false-positive'
  | 'needs-context'
  | 'critic-unavailable';

export interface CriticInfo {
  /** e.g. 'anthropic-api', matches EngineConfig.kind vocabulary. */
  kind: string;
  /** FULL model id, e.g. 'claude-haiku-4-5-20251001'. */
  modelId: string;
  /** ISO 8601 calendar date of the modelId's release. */
  releaseDate: string;
  /** Family taxonomy per surface §"Family taxonomy". */
  family: string;
  /** Per-finding cost captured immediately after the critic.call() resolves. */
  costUsd: number | null;
}

// ── Finding stub (Protocol-2 surface — real type WIP under track-p2-preset) ─
//
// STUB: real type from "core/protocol/preset/types" (Track P2 WIP)
// Per surface 14 §"Core types". Lead integration step replaces this stub with
// the real Protocol-2 import.
export interface Finding {
  id: string;
  presetId: string;
  ruleId: string;
  severity: 'P1' | 'P2' | 'P3';
  file: string;
  line: number;
  evidence: string;
  matched_content_normalized: string;
  message: string;
  remediationHint: string | null;
  fixAvailable: 'template' | 'llm-only' | null;
  version: '1.0';
}

// ── Verdicted finding (Protocol-1 output) ───────────────────────────────────

export interface VerdictedFinding extends Finding {
  verdict: Verdict;
  /** null iff verdict === 'critic-unavailable'. */
  critic: CriticInfo | null;
  /** Free text, may be error msg when critic-unavailable. */
  reasoning: string | null;
  /** Non-empty iff verdict === 'needs-context'. */
  requiredContext: string[] | null;
  version: '1.0';
}

// ── Critic policy + minimal engine call contract ────────────────────────────

/**
 * What P1 invokes on the critic engine. Engines may implement more; P1 only
 * needs these three members. Test mocks implement just this surface.
 */
export interface MinimalCriticEngineSurface {
  /** Returns the raw model response as a string. P1 parses to JSON internally. */
  call(
    prompt: string,
    opts?: { schema?: unknown; timeoutMs?: number },
  ): Promise<string>;

  /** Per-call cost reporting (used by reviewBatch cost-cap accounting). */
  lastCallCostUsd(): number | null;

  /** Static metadata accessor; mirrors the EngineConfig fields. */
  getMeta(): { kind: string; modelId: string; releaseDate: string };
}

export interface CriticPolicy {
  worker: EngineConfig;
  /** Equals worker iff !crossFamily. */
  critic: EngineConfig;
  /** Resolved engine instance ready to call. */
  criticEngine: MinimalCriticEngineSurface;
  crossFamily: boolean;
  reason: 'cross-family-active' | 'no-critic-configured' | 'same-family-as-worker';
}

// ── Fix proposal ────────────────────────────────────────────────────────────

export interface FixProposal {
  findingId: string;
  proposalKind: 'llm-only';
  /** Unified diff. */
  patch: string;
  /** Shell command; exit non-zero iff finding gone after patch. */
  verifyStep: string;
  verified: boolean;
  reasoning: string;
  critic: CriticInfo;
  version: '1.0';
}
