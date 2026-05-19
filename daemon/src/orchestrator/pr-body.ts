import type { Gap, Session, ReasonCode, GapStatus } from '../types.js';

export interface RejectedGapEntry {
  slug: string;
  title: string;
  severity: string;
  reasonCode: ReasonCode | null;
  status: GapStatus;
}

export interface RenderPrBodyInput {
  session: Pick<Session, 'id' | 'baseBranch'>;
  /** The gap this PR fixes. */
  gap: Pick<Gap, 'slug' | 'title' | 'severity' | 'category' | 'body'>;
  fixId: number;
  /** Optional reviewer scores to surface in the PR body. */
  alignmentScore?: number | null;
  /** Other gaps in the same session that the reviewer rejected (NEED_HUMAN). */
  sessionRejections: RejectedGapEntry[];
  /** Optional cost summary so reviewers see what the run spent. */
  costUsd?: number;
}

const REASON_LABEL: Record<string, string> = {
  OK: 'OK',
  BUGGY: 'reviewer marked BUGGY',
  INCOMPLETE: 'reviewer marked INCOMPLETE',
  SCOPE_CREEP: 'scope creep detected',
  STATIC_GATE: 'static gate failed (build / typecheck / test)',
  IMPLEMENTER_FAILURES: 'implementer could not produce valid edits',
  K_EXHAUSTED: 'retry budget exhausted',
  NON_JSON: 'engine returned non-JSON',
  ALIGNMENT_LOW: 'alignment score below threshold',
  ADVERSARIAL_BREAK: 'adversarial reviewer broke the change',
  CONFLICT: 'cherry-pick conflict during PR-mode push',
  PR_PUSH_FAILED: 'git push to remote failed',
};

function reasonLabel(code: ReasonCode | null): string {
  if (!code) return 'rejected';
  return REASON_LABEL[code] ?? code;
}

/**
 * Render the PR body for an auto-opened d2p PR. Includes:
 *   1) the gap that the PR fixes (title + severity + one-line description)
 *   2) reviewer scoring summary
 *   3) NEED_HUMAN gaps from the same session, with reason codes
 *   4) cost / token / d2p session ref footer
 *
 * Output is plain Markdown; reviewers see why the PR exists, what got rejected
 * in the same run, and a session ref to find more detail in `.d2p/session-summary.md`.
 */
export function renderPrBody(input: RenderPrBodyInput): string {
  const lines: string[] = [];

  lines.push(`Opened automatically by d2p (session #${input.session.id}, fix #${input.fixId}).`);
  lines.push('');
  lines.push(`## Gap`);
  lines.push(`- **slug**: \`${input.gap.slug}\``);
  lines.push(`- **severity**: ${input.gap.severity}`);
  lines.push(`- **category**: ${input.gap.category}`);
  lines.push('');
  if (input.gap.body) {
    lines.push(input.gap.body.trim());
    lines.push('');
  }

  // Reviewer scoring
  if (input.alignmentScore != null) {
    lines.push(`## Reviewer scoring`);
    lines.push(`- alignment score: **${input.alignmentScore.toFixed(2)}**`);
    lines.push(`- behavioral verdict: **APPROVE** (otherwise this PR wouldn't exist)`);
    lines.push('');
  }

  // Rejected gaps in the same session — transparency for reviewers
  if (input.sessionRejections.length > 0) {
    lines.push(`## Other gaps in this session (${input.sessionRejections.length} not in this PR)`);
    lines.push('');
    lines.push('These were surfaced by the differ but the reviewer pipeline rejected the auto-fix. Marked `NEED_HUMAN` in this session\'s state; left for you to triage.');
    lines.push('');
    for (const r of input.sessionRejections) {
      lines.push(`- \`${r.slug}\` (${r.severity}) — ${reasonLabel(r.reasonCode)}: ${r.title}`);
    }
    lines.push('');
  }

  // Footer
  lines.push(`---`);
  const costStr = input.costUsd != null ? ` · cost ~$${input.costUsd.toFixed(2)}` : '';
  lines.push(`_d2p session #${input.session.id}, base \`${input.session.baseBranch}\`${costStr}_`);
  lines.push(`_See \`.d2p/session-summary.md\` in the repo for the full run log._`);

  return lines.join('\n');
}
