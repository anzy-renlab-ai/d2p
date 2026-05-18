import { describe, it, expect } from 'vitest';
import { judgeComplexity, explainComplexity } from './complexity.js';
import type { Gap } from '../types.js';

function gap(overrides: Partial<Gap>): Gap {
  return {
    id: 1,
    sessionId: 1,
    slug: 'g',
    title: '',
    body: '',
    category: 'auth',
    severity: 'P2',
    source: 'preset',
    suggestedApproach: '',
    expectedFilesChanged: [],
    status: 'PENDING',
    dynamicK: null,
    parentGapId: null,
    createdAt: 0,
    finishedAt: null,
    complexity: 'simple',
    ...overrides,
  };
}

describe('judgeComplexity', () => {
  it('returns simple when no signals match', () => {
    expect(judgeComplexity(gap({ title: 'add health endpoint' }))).toBe('simple');
  });

  it('escalates to complex when ≥3 files would change', () => {
    expect(
      judgeComplexity(
        gap({
          expectedFilesChanged: ['a.ts', 'b.ts', 'c.ts'],
        }),
      ),
    ).toBe('complex');
  });

  it('stays simple with 2 files touched', () => {
    expect(
      judgeComplexity(
        gap({
          expectedFilesChanged: ['a.ts', 'b.ts'],
        }),
      ),
    ).toBe('simple');
  });

  it.each([
    ['title contains 重构', { title: '重构 auth 中间件' }],
    ['body contains refactor', { body: 'we need to refactor the token loader' }],
    ['suggestedApproach contains migrate', { suggestedApproach: 'migrate from session cookies to JWT' }],
    ['title contains rewrite', { title: 'rewrite cache layer' }],
    ['body mentions dependency upgrade', { body: 'do a dependency upgrade pass for security audits' }],
    ['integration test wording', { title: 'fix flaky integration test in auth flow' }],
  ])('keyword: %s → complex', (_label, overrides) => {
    expect(judgeComplexity(gap(overrides))).toBe('complex');
  });

  it('is case-insensitive on keywords', () => {
    expect(judgeComplexity(gap({ title: 'REFACTOR billing' }))).toBe('complex');
  });
});

describe('explainComplexity', () => {
  it('returns simple verdict with empty reasons when nothing matches', () => {
    const r = explainComplexity(gap({ title: 'add health endpoint' }));
    expect(r.complexity).toBe('simple');
    expect(r.reasons).toEqual([]);
  });

  it('collects file-count reason', () => {
    const r = explainComplexity(gap({ expectedFilesChanged: ['a', 'b', 'c', 'd'] }));
    expect(r.complexity).toBe('complex');
    expect(r.reasons.some((s) => s.includes('expectedFilesChanged=4'))).toBe(true);
  });

  it('collects keyword reasons', () => {
    const r = explainComplexity(gap({ title: 'refactor auth', body: 'also migrate token store' }));
    expect(r.complexity).toBe('complex');
    expect(r.reasons.length).toBeGreaterThan(1);
    expect(r.reasons.some((s) => s.includes('refactor'))).toBe(true);
  });
});
