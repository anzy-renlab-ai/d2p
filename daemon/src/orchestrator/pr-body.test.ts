import { describe, it, expect } from 'vitest';
import { renderPrBody } from './pr-body.js';

const baseGap = {
  slug: 'auth-csrf-protection',
  title: 'CSRF protection missing on mutating routes',
  severity: 'P1' as const,
  category: 'security' as const,
  body: 'POST/PUT/DELETE handlers should reject requests without a valid CSRF token.',
};

describe('renderPrBody', () => {
  it('includes gap slug + severity + body', () => {
    const md = renderPrBody({
      session: { id: 4, baseBranch: 'main' },
      gap: baseGap,
      fixId: 47,
      sessionRejections: [],
    });
    expect(md).toContain('`auth-csrf-protection`');
    expect(md).toContain('P1');
    expect(md).toContain('POST/PUT/DELETE');
  });

  it('shows alignment score when provided', () => {
    const md = renderPrBody({
      session: { id: 4, baseBranch: 'main' },
      gap: baseGap,
      fixId: 47,
      alignmentScore: 0.92,
      sessionRejections: [],
    });
    expect(md).toContain('alignment score: **0.92**');
    expect(md).toContain('behavioral verdict: **APPROVE**');
  });

  it('lists rejected gaps with reason codes', () => {
    const md = renderPrBody({
      session: { id: 4, baseBranch: 'main' },
      gap: baseGap,
      fixId: 47,
      sessionRejections: [
        {
          slug: 'a11y-basic-issues',
          title: 'Forms missing accessible labels',
          severity: 'P2',
          reasonCode: 'INCOMPLETE',
          status: 'NEED_HUMAN',
        },
        {
          slug: 'smoke-tests',
          title: 'No smoke tests',
          severity: 'P1',
          reasonCode: 'K_EXHAUSTED',
          status: 'NEED_HUMAN',
        },
      ],
    });
    expect(md).toContain('Other gaps in this session (2 not in this PR)');
    expect(md).toContain('`a11y-basic-issues`');
    expect(md).toContain('reviewer marked INCOMPLETE');
    expect(md).toContain('retry budget exhausted');
  });

  it('omits the rejected-gaps section when none', () => {
    const md = renderPrBody({
      session: { id: 4, baseBranch: 'main' },
      gap: baseGap,
      fixId: 47,
      sessionRejections: [],
    });
    expect(md).not.toContain('Other gaps in this session');
  });

  it('shows cost in footer when given', () => {
    const md = renderPrBody({
      session: { id: 4, baseBranch: 'main' },
      gap: baseGap,
      fixId: 47,
      sessionRejections: [],
      costUsd: 4.24,
    });
    expect(md).toContain('cost ~$4.24');
    expect(md).toContain('session #4');
    expect(md).toContain('base `main`');
  });

  it('handles unknown reason code by falling through to the raw string', () => {
    const md = renderPrBody({
      session: { id: 4, baseBranch: 'main' },
      gap: baseGap,
      fixId: 47,
      // @ts-expect-error — intentional unknown for resilience test
      sessionRejections: [{ slug: 'x', title: 't', severity: 'P3', reasonCode: 'WEIRD_NEW_REASON', status: 'NEED_HUMAN' }],
    });
    expect(md).toContain('WEIRD_NEW_REASON');
  });
});
