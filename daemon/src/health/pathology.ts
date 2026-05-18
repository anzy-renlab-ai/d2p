// F3 — agent-pathology detector.
//
// Watches d2p's own event stream for signatures of known autonomous-agent
// failure modes (fixation, thrash, critic-bias, runaway-cost) and surfaces
// them as Mission Control badges. Every signature here is grounded in a
// publicly-documented failure: Devin's "persists on impossible tasks" and
// "fixates on irrelevant root cause"; Replit Agent 3's "gets stuck loops" and
// production-DB-wipe; the OpenHands V1 / Cursor 2.0 reports of critic-bias.
//
// This module is intentionally pure: it takes a list of LogEvents and returns
// the current pathology state. Wiring to the live event bus + emit() lives in
// a separate watcher; tests here run on synthetic streams.

import type { LogEventKind, PathologyKind, PathologyLevel } from '../types.js';

export interface AnalyzedEvent {
  kind: LogEventKind;
  ts: number;
  payload: Record<string, unknown>;
}

export interface PathologyState {
  kind: PathologyKind;
  level: PathologyLevel;
  detail: string;
  evidenceEventIds: number[];
}

export interface PathologyThresholds {
  fixationAttempts: number;          // ≥3 attempts on same slug in a row → warn
  thrashRevertPct: number;           // ≥0.5 = ≥50% recent merges reverted → warn
  thrashWindowMs: number;            // measurement window for thrash
  criticBiasMinSamples: number;      // need ≥N reviewer outcomes before judging
  criticBiasAgreementBelow: number;  // ≤0.6 agreement → warn
  runawayUsdPerMin: number;          // ≥$X/min → warn
}

export const DEFAULT_THRESHOLDS: PathologyThresholds = {
  fixationAttempts: 3,
  thrashRevertPct: 0.4,
  thrashWindowMs: 30 * 60_000,
  criticBiasMinSamples: 5,
  criticBiasAgreementBelow: 0.6,
  runawayUsdPerMin: 0.5,
};

/** Run all 4 detectors against an ordered event stream (oldest first). */
export function analyzeEvents(
  events: AnalyzedEvent[],
  thresholds: PathologyThresholds = DEFAULT_THRESHOLDS,
  now: number = Date.now(),
): PathologyState[] {
  return [
    detectFixation(events, thresholds),
    detectThrash(events, thresholds, now),
    detectCriticBias(events, thresholds),
    detectRunawayCost(events, thresholds, now),
  ].filter((s): s is PathologyState => s !== null);
}

/** Fixation = same slug picked + reviewer-rejected ≥ N times in a row. */
export function detectFixation(events: AnalyzedEvent[], t: PathologyThresholds): PathologyState | null {
  // Walk backwards counting consecutive failed attempts on the same slug.
  // A "failed attempt" is a REVIEW_VERDICT with verdict != APPROVE OR a
  // STATIC_GATE_FAILED. Reset on MERGED / GAP_DONE.
  let currentSlug: string | null = null;
  let consecutiveFails = 0;
  const lastEvents: AnalyzedEvent[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind === 'MERGED' || e.kind === 'GAP_DONE') break;
    if (e.kind === 'GAP_PICKED') {
      const slug = String(e.payload.slug ?? '');
      if (currentSlug === null) currentSlug = slug;
      if (slug !== currentSlug) break;
      // Each GAP_PICKED on the same slug = a new attempt
    }
    const isFail =
      e.kind === 'STATIC_GATE_FAILED' ||
      (e.kind === 'REVIEW_VERDICT' && e.payload.verdict !== 'APPROVE');
    if (isFail) {
      consecutiveFails++;
      lastEvents.push(e);
    }
  }
  if (consecutiveFails >= t.fixationAttempts && currentSlug) {
    return {
      kind: 'fixation',
      level: consecutiveFails >= t.fixationAttempts + 1 ? 'crit' : 'warn',
      detail: `${currentSlug} · ${consecutiveFails} consecutive failures (threshold ${t.fixationAttempts})`,
      evidenceEventIds: [],
    };
  }
  return null;
}

/** Thrash = high revert rate within a recent window. */
export function detectThrash(
  events: AnalyzedEvent[],
  t: PathologyThresholds,
  now: number,
): PathologyState | null {
  const since = now - t.thrashWindowMs;
  let merges = 0;
  let reverts = 0;
  for (const e of events) {
    if (e.ts < since) continue;
    if (e.kind === 'MERGED') merges++;
    // FIX_DROPPED carries the role of a "revert" in d2p's vocabulary —
    // a previously-committed candidate that didn't make it.
    if (e.kind === 'FIX_DROPPED') reverts++;
  }
  if (merges + reverts === 0) return null;
  const ratio = reverts / Math.max(merges + reverts, 1);
  if (ratio < t.thrashRevertPct) return null;
  return {
    kind: 'thrash',
    level: ratio > 0.7 ? 'crit' : 'warn',
    detail: `${reverts} dropped / ${merges + reverts} total in last ${(t.thrashWindowMs / 60_000) | 0}m (${Math.round(ratio * 100)}%)`,
    evidenceEventIds: [],
  };
}

/** Critic bias = reviewer-agreement rate too low. Computed as the fraction of
 *  REVIEW_VERDICT outcomes that are APPROVE — too-low rate means the critic is
 *  rejecting almost everything (often a same-family-as-worker bias signature). */
export function detectCriticBias(events: AnalyzedEvent[], t: PathologyThresholds): PathologyState | null {
  const verdicts = events.filter((e) => e.kind === 'REVIEW_VERDICT');
  if (verdicts.length < t.criticBiasMinSamples) return null;
  const approves = verdicts.filter((e) => e.payload.verdict === 'APPROVE').length;
  const rate = approves / verdicts.length;
  if (rate >= t.criticBiasAgreementBelow) return null;
  return {
    kind: 'critic-bias',
    level: rate < 0.3 ? 'crit' : 'warn',
    detail: `agreement rate ${rate.toFixed(2)} over ${verdicts.length} reviews — consider adding a 2nd engine`,
    evidenceEventIds: [],
  };
}

/** Runaway cost = spend rate per minute > threshold. */
export function detectRunawayCost(
  events: AnalyzedEvent[],
  t: PathologyThresholds,
  now: number,
): PathologyState | null {
  // Sum estimatedUsd from AGENT_END events in the last 5 minutes.
  const window = 5 * 60_000;
  const since = now - window;
  let usd = 0;
  for (const e of events) {
    if (e.ts < since) continue;
    if (e.kind !== 'AGENT_END') continue;
    const v = Number(e.payload.estimatedUsd ?? 0);
    if (Number.isFinite(v)) usd += v;
  }
  const usdPerMin = usd / (window / 60_000);
  if (usdPerMin < t.runawayUsdPerMin) return null;
  return {
    kind: 'runaway-cost',
    level: usdPerMin > t.runawayUsdPerMin * 2 ? 'crit' : 'warn',
    detail: `$${usdPerMin.toFixed(2)}/min over last 5m (threshold $${t.runawayUsdPerMin.toFixed(2)}/min)`,
    evidenceEventIds: [],
  };
}
