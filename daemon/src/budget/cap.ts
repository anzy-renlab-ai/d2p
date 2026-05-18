// F6 — per-session cost budget enforcement.
//
// d2p targets users running on tokenplans (MiniMax, DeepSeek, Z.ai, …) — they
// leave a session going for hours. Without a visible budget, "I'll let it run
// overnight" turns into "I owe $40 and didn't watch the meter." Replit Agent 3
// shipped effort-based billing for exactly this reason; Devin's opaque pricing
// is its own widely-cited trust-killer.
//
// Soft breach: emit a warning + (configurable) either downgrade the requested
// model tier (sonnet → haiku) or request a pause. Hard breach: refuse new
// calls; the runner aborts in-flight attempts and emits BUDGET_HIT.

import type { CostBudget } from '../config/types.js';
import type { ClaudeModel } from '../types.js';

export interface BudgetCheckOpts {
  budget: CostBudget | null | undefined;
  spentUsd: number;
  requestedModel: ClaudeModel;
}

export type BudgetVerdict =
  | { action: 'proceed' }
  | { action: 'downgrade'; from: ClaudeModel; to: ClaudeModel; reason: 'soft-breach' }
  | { action: 'pause'; reason: 'soft-breach-pause' }
  | { action: 'abort'; reason: 'hard-breach' };

const TIER_DOWNGRADE: Record<ClaudeModel, ClaudeModel> = {
  opus: 'sonnet',
  sonnet: 'haiku',
  haiku: 'haiku', // already minimum
};

export function checkBudget(opts: BudgetCheckOpts): BudgetVerdict {
  const b = opts.budget;
  if (!b) return { action: 'proceed' };

  if (opts.spentUsd >= b.hardUsd) {
    return { action: 'abort', reason: 'hard-breach' };
  }
  if (opts.spentUsd >= b.softUsd) {
    if (b.onSoftBreach === 'pause') return { action: 'pause', reason: 'soft-breach-pause' };
    const target = TIER_DOWNGRADE[opts.requestedModel];
    if (target === opts.requestedModel) {
      // Already at haiku — nothing more to degrade. Proceed but don't trigger
      // ANOTHER downgrade event; caller still gets the spend metric.
      return { action: 'proceed' };
    }
    return { action: 'downgrade', from: opts.requestedModel, to: target, reason: 'soft-breach' };
  }
  return { action: 'proceed' };
}

/** Map verdict to the effective model the caller should use. */
export function applyVerdict(verdict: BudgetVerdict, requested: ClaudeModel): ClaudeModel | null {
  switch (verdict.action) {
    case 'proceed':
      return requested;
    case 'downgrade':
      return verdict.to;
    case 'pause':
    case 'abort':
      return null;
  }
}
