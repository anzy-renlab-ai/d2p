/**
 * BranchState — Mission Control state machine for the branch tree.
 *
 * ZeroU's product story is "we handle the gaps". The tree never says "this
 * is uncovered because…" — instead each leaf advertises one of five live
 * states. Red is split into two flavours so the user knows what ZeroU CAN
 * vs CAN'T auto-fix:
 *
 *   - mechanical-red  → patcher could fix (missing encodeURIComponent,
 *                        silent catch, sanitize, null guard, etc.)
 *   - business-red    → needs human (IDOR / race / missing auth check /
 *                        domain logic)
 *
 * Backend (cli/agent/zerou-runner) does not yet emit `state` or `category`
 * on a BranchTraceEvent. Until it does, we derive both from `verdict` +
 * heuristics on `branch_kind` / `branch_label`. When backend starts
 * emitting them, those explicit fields take precedence.
 */

import type { BranchTraceEvent } from '../types-zerou.js';

export type BranchState =
  | 'pending'        // haven't reached yet; tree shows on initial load before audit
  | 'evaluating'     // LLM-judge currently working
  | 'covered'        // 4 signals all green
  | 'mechanical-red' // patcher could potentially fix
  | 'business-red'   // needs human (auth / race / domain logic)
  | 'retrying';      // patcher attempting fix; show "retry N/M"

export type BranchCategory = 'mechanical' | 'business';

/** UI-only superset of BranchTraceEvent. Backend may populate `state` /
 *  `category` later; until then they're synthesized in the mock bundle. */
export interface BranchTraceEventLite extends BranchTraceEvent {
  state?: BranchState;
  category?: BranchCategory;
  /** Optional retry counter — only meaningful when state === 'retrying'.
   *  Shape: [attempt, maxAttempts]; rendered as "retry 2/3". */
  retry?: { attempt: number; max: number };
}

// ── Derivation rules ──────────────────────────────────────────────────────

/**
 * Derive the live UI state for one branch event.
 *
 * Order of precedence:
 *   1. explicit `state` field (live mode, backend-set) → use as-is
 *   2. verdict === 'covered' or 'run-only' → 'covered'
 *   3. anything else (untested / unknown / spec-only / judge-only) → classify
 *      as mechanical-red or business-red via heuristic
 *
 * Note on partial signals: a branch with only spec-OR-judge-OR-run (not all
 * four) is still self-deceiving — we count it as red. This is intentional.
 */
export function deriveBranchState(event: BranchTraceEventLite): BranchState {
  if (event.state) return event.state;
  const v = event.verdict;
  if (v === 'covered' || v === 'run-only') return 'covered';
  // partial signals (judge-only / spec-only) are still self-deceiving → red
  return classifyRedCategory(event);
}

/**
 * Classify a red branch as mechanical-red or business-red.
 *
 * Heuristic (only used when backend doesn't tell us via `category`):
 *   - `category` explicit → trust it
 *   - branch_kind === 'catch' / 'try-body' / 'finally' → mechanical-red
 *     (silent catches are the canonical auto-fixable case)
 *   - branch_label contains auth/role/owner/admin/user_id/tenant/password/
 *     token/session → business-red (auth boundary needs human review)
 *   - branch_label mentions encodeURIComponent/escapeXml/sanitize/null-check
 *     → mechanical-red
 *   - default: business-red (conservative — assume needs human if we
 *     can't tell). Better to under-claim auto-fix capability than to
 *     promise mechanical fixes that fail in CI.
 */
export function classifyRedCategory(
  event: BranchTraceEventLite,
): 'mechanical-red' | 'business-red' {
  if (event.category) {
    return event.category === 'mechanical' ? 'mechanical-red' : 'business-red';
  }
  const kind = (event.branch_kind ?? '').toLowerCase();
  const label = (event.branch_label ?? '').toLowerCase();

  // Business-red checks come first — auth boundary is high-signal and
  // can appear inside try/catch blocks too.
  if (/\b(auth|role|owner|admin|user_id|tenant|password|token|session)\b/.test(label)) {
    return 'business-red';
  }
  if (kind === 'catch' || kind === 'try-body' || kind === 'finally') {
    return 'mechanical-red';
  }
  if (/encodeuricomponent|escapexml|sanitize|null[\s-]?check|undefined[\s-]?check/i.test(label)) {
    return 'mechanical-red';
  }
  return 'business-red';
}

// ── Aggregate state across many events (for HeatStrip) ────────────────────

export interface FileStateBreakdown {
  total: number;
  covered: number;
  evaluating: number;
  retrying: number;
  mechanicalRed: number;
  businessRed: number;
  pending: number;
  /** Single "rolled-up" state. 'mixed' when more than one non-pending bucket
   *  has events. Picks the worst when there's a tie (business-red wins). */
  aggregate: BranchState | 'mixed';
}

const STATE_ORDER: BranchState[] = [
  'business-red',
  'mechanical-red',
  'retrying',
  'evaluating',
  'covered',
  'pending',
];

export function aggregateFileState(events: BranchTraceEventLite[]): FileStateBreakdown {
  const b: FileStateBreakdown = {
    total: events.length,
    covered: 0,
    evaluating: 0,
    retrying: 0,
    mechanicalRed: 0,
    businessRed: 0,
    pending: 0,
    aggregate: 'pending',
  };
  if (events.length === 0) return b;

  for (const ev of events) {
    const s = deriveBranchState(ev);
    if (s === 'covered') b.covered += 1;
    else if (s === 'evaluating') b.evaluating += 1;
    else if (s === 'retrying') b.retrying += 1;
    else if (s === 'mechanical-red') b.mechanicalRed += 1;
    else if (s === 'business-red') b.businessRed += 1;
    else b.pending += 1;
  }

  // Count how many distinct non-zero buckets there are.
  const nonZero = [
    b.covered,
    b.evaluating,
    b.retrying,
    b.mechanicalRed,
    b.businessRed,
    b.pending,
  ].filter((n) => n > 0).length;

  if (nonZero > 1) {
    b.aggregate = 'mixed';
  } else {
    // single bucket — pick by which has count > 0 in priority order.
    for (const st of STATE_ORDER) {
      if (st === 'covered' && b.covered > 0) { b.aggregate = 'covered'; break; }
      if (st === 'evaluating' && b.evaluating > 0) { b.aggregate = 'evaluating'; break; }
      if (st === 'retrying' && b.retrying > 0) { b.aggregate = 'retrying'; break; }
      if (st === 'mechanical-red' && b.mechanicalRed > 0) { b.aggregate = 'mechanical-red'; break; }
      if (st === 'business-red' && b.businessRed > 0) { b.aggregate = 'business-red'; break; }
      if (st === 'pending' && b.pending > 0) { b.aggregate = 'pending'; break; }
    }
  }
  return b;
}

// ── Visual tokens ─────────────────────────────────────────────────────────

/** Single-glyph for a leaf. Wrench / lock overlays are rendered separately. */
export const STATE_GLYPH: Record<BranchState, string> = {
  pending: '○',
  evaluating: '↻',
  covered: '✓',
  'mechanical-red': '✗',
  'business-red': '✗',
  retrying: '↻',
};

/** Tailwind text-color token for the glyph. */
export const STATE_TONE: Record<BranchState, string> = {
  pending: 'text-muted/50',
  evaluating: 'text-coral',
  covered: 'text-forest',
  'mechanical-red': 'text-rust/80',
  'business-red': 'text-rust',
  retrying: 'text-coral',
};

/** Tailwind animation class for the glyph. */
export const STATE_ANIM: Record<BranchState, string> = {
  pending: '',
  evaluating: 'anim-spin-arrow',
  covered: '',
  'mechanical-red': '',
  'business-red': '',
  retrying: 'anim-retry-pulse',
};

/** Optional overlay icon next to the glyph (for the two red flavours). */
export const STATE_OVERLAY: Partial<Record<BranchState, string>> = {
  'mechanical-red': '🔧',
  'business-red': '🔒',
};

/** Background colour for HeatStrip squares (solid colour cases). */
export const STATE_BG: Record<BranchState, string> = {
  pending: 'bg-muted/20',
  evaluating: 'bg-coral',
  covered: 'bg-forest',
  'mechanical-red': 'bg-rust/70',
  'business-red': 'bg-rust',
  retrying: 'bg-coral/60',
};

/** Human label used by aria attributes. */
export const STATE_LABEL: Record<BranchState, string> = {
  pending: 'pending',
  evaluating: 'evaluating',
  covered: 'covered',
  'mechanical-red': 'mechanical red — patcher can fix',
  'business-red': 'business red — needs human',
  retrying: 'retrying',
};

// ── Sort priority for tree leaves ─────────────────────────────────────────
//
// Tree should bubble the most-attention-needed leaves to the top:
//   business-red > mechanical-red > retrying > evaluating > pending > covered
//
// Rationale: business-red is the hardest fix (human needed) — surface it.
// Covered is silent good news, can be at the bottom or collapsed.

export const STATE_SORT_RANK: Record<BranchState, number> = {
  'business-red': 0,
  'mechanical-red': 1,
  retrying: 2,
  evaluating: 3,
  pending: 4,
  covered: 5,
};

export function compareStates(a: BranchState, b: BranchState): number {
  return STATE_SORT_RANK[a] - STATE_SORT_RANK[b];
}
