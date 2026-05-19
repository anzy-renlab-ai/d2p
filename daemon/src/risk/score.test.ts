/**
 * Tests for scoreCommit — covers each rule independently and interactions.
 */

import { describe, it, expect } from 'vitest';
import { scoreCommit } from './score.js';
import type { FileDiff } from '../types.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeFile(overrides: Partial<FileDiff> = {}): FileDiff {
  return {
    path: 'src/feature.ts',
    status: 'modified',
    oldPath: null,
    insertions: 5,
    deletions: 2,
    binary: false,
    hunks: [
      {
        header: '@@ -1,2 +1,5 @@',
        oldStart: 1, oldLines: 2, newStart: 1, newLines: 5,
        lines: [
          { type: 'context', text: 'ctx', oldLineNo: 1, newLineNo: 1 },
          { type: 'add', text: 'new line', oldLineNo: null, newLineNo: 2 },
        ],
      },
    ],
    ...overrides,
  };
}

function makeDeletionHeavyFile(): FileDiff {
  // 60 deletions — triggers R1
  const lines = Array.from({ length: 60 }, (_, i) => ({
    type: 'del' as const,
    text: `line ${i}`,
    oldLineNo: i + 1,
    newLineNo: null,
  }));
  return {
    path: 'src/big-delete.ts',
    status: 'modified',
    oldPath: null,
    insertions: 0,
    deletions: 60,
    binary: false,
    hunks: [{ header: '@@ -1,60 +0,0 @@', oldStart: 1, oldLines: 60, newStart: 0, newLines: 0, lines }],
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('scoreCommit', () => {
  it('returns low band for a simple benign change with a test file', () => {
    const diff: FileDiff[] = [
      makeFile({ path: 'src/feature.ts', insertions: 3, deletions: 1 }),
      makeFile({ path: 'src/feature.test.ts', insertions: 5, deletions: 0 }),
    ];
    const result = scoreCommit(diff);
    expect(result.band).toBe('low');
    expect(result.score).toBe(0.1);
    expect(result.reasons).toHaveLength(0);
  });

  it('R1: >50 deletions → at least mid', () => {
    const diff: FileDiff[] = [
      makeDeletionHeavyFile(),
      makeFile({ path: 'src/big-delete.test.ts' }),
    ];
    const result = scoreCommit(diff);
    expect(['mid', 'high']).toContain(result.band);
    expect(result.reasons.some((r) => r.startsWith('R1:'))).toBe(true);
  });

  it('R2: touches package.json → at least mid', () => {
    const diff: FileDiff[] = [
      makeFile({ path: 'package.json', deletions: 2 }),
      makeFile({ path: 'src/index.test.ts' }),
    ];
    const result = scoreCommit(diff);
    expect(['mid', 'high']).toContain(result.band);
    expect(result.reasons.some((r) => r.startsWith('R2:'))).toBe(true);
  });

  it('R2: touches migrations/ → at least mid', () => {
    const diff: FileDiff[] = [
      makeFile({ path: 'daemon/src/storage/migrations/007-risk.ts' }),
      makeFile({ path: 'src/foo.test.ts' }),
    ];
    const result = scoreCommit(diff);
    expect(['mid', 'high']).toContain(result.band);
    expect(result.reasons.some((r) => r.startsWith('R2:'))).toBe(true);
  });

  it('R2: touches .github/workflows/ → at least mid', () => {
    const diff: FileDiff[] = [
      makeFile({ path: '.github/workflows/ci.yml' }),
      makeFile({ path: 'src/bar.test.ts' }),
    ];
    const result = scoreCommit(diff);
    expect(['mid', 'high']).toContain(result.band);
    expect(result.reasons.some((r) => r.startsWith('R2:'))).toBe(true);
  });

  it('R3: touches core-paths glob → high', () => {
    const diff: FileDiff[] = [
      makeFile({ path: 'lib/db/schema.ts' }),
      makeFile({ path: 'src/feature.test.ts' }),
    ];
    const result = scoreCommit(diff, { corePaths: ['lib/db/**'] });
    expect(result.band).toBe('high');
    expect(result.score).toBe(0.9);
    expect(result.reasons.some((r) => r.startsWith('R3:'))).toBe(true);
  });

  it('R4: no test file → at least mid', () => {
    const diff: FileDiff[] = [
      makeFile({ path: 'src/feature.ts' }),
    ];
    const result = scoreCommit(diff);
    expect(['mid', 'high']).toContain(result.band);
    expect(result.reasons.some((r) => r.startsWith('R4:'))).toBe(true);
  });

  it('R4 does not fire when diff is empty', () => {
    const result = scoreCommit([]);
    expect(result.band).toBe('low');
    expect(result.reasons.some((r) => r.startsWith('R4:'))).toBe(false);
  });

  it('multiple rules fire simultaneously (R1+R4)', () => {
    const diff: FileDiff[] = [makeDeletionHeavyFile()];
    const result = scoreCommit(diff);
    const ruleNums = result.reasons.map((r) => r.slice(0, 2));
    expect(ruleNums).toContain('R1');
    expect(ruleNums).toContain('R4');
  });

  it('reviewHunks are populated for non-test files', () => {
    const diff: FileDiff[] = [
      makeFile({ path: 'src/important.ts' }),
    ];
    const result = scoreCommit(diff);
    // At least one reviewHunk since we have a non-test file with lines
    expect(result.reviewHunks.length).toBeGreaterThan(0);
  });
});
