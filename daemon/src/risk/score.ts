/**
 * scoreCommit — hybrid rule + (optional LLM) risk scoring for a commit diff.
 *
 * Rule layer runs synchronously and is always active.
 * LLM layer is gated behind D2P_RISK_LLM=1 (currently a no-op placeholder).
 *
 * Rules:
 *   R1: >50 line deletions → at least 'mid'
 *   R2: touches package.json / migrations/ / .github/workflows/ / Dockerfile /
 *       lib/db/ / lib/auth/ → at least 'mid'
 *   R3: touches any path matching context.corePaths glob → 'high'
 *   R4: no test file in changed paths → at least 'mid'
 *
 * Score mapping:
 *   low  → 0.1
 *   mid  → 0.5
 *   high → 0.9
 */

import type { FileDiff, CommitRisk, RiskBand, ReviewHunk } from '../types.js';
import { matchGlob } from '../core-paths/checker.js';

// Sensitive path patterns for R2
const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /(?:^|[\\/])package\.json$/,
  /migrations[\\/]/,
  /\.github[\\/]workflows[\\/]/,
  /(?:^|[\\/])Dockerfile$/,
  /lib[\\/]db[\\/]/,
  /lib[\\/]auth[\\/]/,
];

// Test file heuristic — path contains test/spec segment or .test. / .spec.
const TEST_PATH_RE = /[\\/]?(?:__tests__[\\/]|tests?[\\/]|spec[\\/]|\.test\.|\.spec\.)/i;

function isSensitivePath(p: string): boolean {
  return SENSITIVE_PATH_PATTERNS.some((re) => re.test(p));
}

function isTestFile(p: string): boolean {
  return TEST_PATH_RE.test(p);
}

export interface ScoreContext {
  corePaths?: string[];
  gapSlug?: string;
}

function bandMin(a: RiskBand, b: RiskBand): RiskBand {
  const order: Record<RiskBand, number> = { low: 0, mid: 1, high: 2 };
  return order[a] >= order[b] ? a : b;
}

function bandScore(band: RiskBand): number {
  if (band === 'high') return 0.9;
  if (band === 'mid') return 0.5;
  return 0.1;
}

export function scoreCommit(diff: FileDiff[], context: ScoreContext = {}): CommitRisk {
  const reasons: string[] = [];
  let band: RiskBand = 'low';

  const changedPaths = diff.map((f) => f.path);

  // R1: >50 total line deletions
  const totalDeletions = diff.reduce((acc, f) => acc + f.deletions, 0);
  if (totalDeletions > 50) {
    band = bandMin(band, 'mid');
    reasons.push(`R1: ${totalDeletions} lines deleted (>50 threshold)`);
  }

  // R2: sensitive paths touched
  const sensitiveTouched = changedPaths.filter(isSensitivePath);
  if (sensitiveTouched.length > 0) {
    band = bandMin(band, 'mid');
    reasons.push(`R2: sensitive paths touched: ${sensitiveTouched.join(', ')}`);
  }

  // R3: core-paths glob match
  if (context.corePaths && context.corePaths.length > 0) {
    const coreHits = changedPaths.filter((p) =>
      context.corePaths!.some((glob) => matchGlob(glob, p)),
    );
    if (coreHits.length > 0) {
      band = bandMin(band, 'high');
      reasons.push(`R3: core-path files touched: ${coreHits.join(', ')}`);
    }
  }

  // R4: no test file present
  const hasTests = changedPaths.some(isTestFile);
  if (!hasTests && diff.length > 0) {
    band = bandMin(band, 'mid');
    reasons.push('R4: no test file in changed paths');
  }

  // Build reviewHunks — select hunks with highest line delta, prefer non-test files
  const reviewHunks: ReviewHunk[] = [];
  const nonTestFiles = diff.filter((f) => !isTestFile(f.path));
  const candidates = nonTestFiles.length > 0 ? nonTestFiles : diff;

  for (const file of candidates.slice(0, 3)) {
    // sort hunks by line count descending
    const sorted = [...file.hunks]
      .map((h, idx) => ({ h, idx, delta: h.lines.filter((l) => l.type !== 'context').length }))
      .sort((a, b) => b.delta - a.delta);

    for (const { idx, delta } of sorted.slice(0, 2)) {
      if (delta === 0) continue;
      const reason = isSensitivePath(file.path)
        ? 'sensitive-path hunk'
        : 'high-delta hunk';
      reviewHunks.push({ path: file.path, hunkIdx: idx, reason });
    }
  }

  return {
    band,
    score: bandScore(band),
    reasons,
    reviewHunks,
  };
}
