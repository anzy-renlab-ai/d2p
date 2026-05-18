import type { Gap, GapComplexity } from '../types.js';

// Decides whether a gap should run through the single-turn `--print` engine
// (claude-cli.ts) or the long-lived stream-json engine (claude-stream.ts).
// Heuristic: prefer 'simple' so existing behavior is preserved; only escalate
// when the gap looks like it genuinely needs multi-turn try / observe / fix.
//
// Inputs we use:
//   - expectedFilesChanged length: ≥3 files touched suggests cross-file
//     coordination cc has to verify by running tests between edits
//   - severity P1: critical correctness work where a one-shot guess can
//     leave broken state worse than no work; the multi-turn loop's "run
//     tests then fix lint" pattern is appropriate
//   - keyword scan over title + body + suggestedApproach: catches refactor /
//     migration / dependency-upgrade work where cc has to see error output
//     to make progress
//
// The user can override the heuristic verdict in the UI (UI work, Batch 5),
// so this judge is intentionally conservative — false negatives (treating
// a complex gap as simple) only cost an extra single-turn attempt; false
// positives (treating a simple gap as complex) burn tokens on a multi-turn
// session that didn't need it.

const COMPLEX_KEYWORDS = [
  // Chinese
  '重构', '迁移', '升级依赖', '依赖升级', '改造', '架构调整',
  // English
  'refactor', 'refactoring',
  'migrat', // matches migrate / migration / migrating
  'upgrade dep', 'dependency upgrade', 'bump dep',
  'rewrite',
  'cross-cutting',
  // Behavior change patterns that typically need iterative validation
  'flaky test', 'integration test', 'e2e test',
];

export function judgeComplexity(gap: Gap): GapComplexity {
  // Cheap structural signal first.
  if ((gap.expectedFilesChanged?.length ?? 0) >= 3) return 'complex';

  // Keyword scan over the human-supplied text fields.
  const text = `${gap.title}\n${gap.body}\n${gap.suggestedApproach}`.toLowerCase();
  for (const kw of COMPLEX_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) return 'complex';
  }

  return 'simple';
}

export interface ComplexityVerdict {
  complexity: GapComplexity;
  reasons: string[];
}

/** Same as judgeComplexity but returns the reasons the verdict was reached.
 *  Used by the UI when explaining why a gap was auto-tagged complex. */
export function explainComplexity(gap: Gap): ComplexityVerdict {
  const reasons: string[] = [];
  if ((gap.expectedFilesChanged?.length ?? 0) >= 3) {
    reasons.push(`expectedFilesChanged=${gap.expectedFilesChanged.length} (≥3)`);
  }
  const text = `${gap.title}\n${gap.body}\n${gap.suggestedApproach}`.toLowerCase();
  for (const kw of COMPLEX_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) {
      reasons.push(`keyword: ${kw}`);
    }
  }
  return {
    complexity: reasons.length > 0 ? 'complex' : 'simple',
    reasons,
  };
}
