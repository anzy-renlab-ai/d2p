import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ZerouVerifyStrip } from './ZerouVerifyStrip.js';
import type { ReviewVerify } from '../types-zerou.js';

describe('ZerouVerifyStrip', () => {
  it('renders one chip per step', () => {
    const verify: ReviewVerify = {
      ok: true,
      steps: [
        { name: 'install', status: 'pass', durationMs: 10_000 },
        { name: 'tsc', status: 'pass', durationMs: 5_000 },
        { name: 'test', status: 'skipped', durationMs: 0 },
        { name: 'build', status: 'pass', durationMs: 30_000 },
      ],
    };
    render(<ZerouVerifyStrip verify={verify} />);
    expect(screen.getByTestId('zerou-verify-step-install')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-verify-step-tsc')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-verify-step-test')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-verify-step-build')).toBeInTheDocument();
  });

  it('shows overall ok state when all pass', () => {
    const verify: ReviewVerify = {
      ok: true,
      steps: [{ name: 'install', status: 'pass', durationMs: 1000 }],
    };
    render(<ZerouVerifyStrip verify={verify} />);
    expect(screen.getByTestId('zerou-verify-overall')).toHaveTextContent(/all pass/);
  });

  it('shows broken-by when verify failed', () => {
    const verify: ReviewVerify = {
      ok: false,
      brokenBy: 'tsc',
      steps: [
        { name: 'install', status: 'pass', durationMs: 1000 },
        { name: 'tsc', status: 'fail', durationMs: 800, failOutput: 'TS2322: type X is not assignable' },
        { name: 'test', status: 'skipped', durationMs: 0 },
        { name: 'build', status: 'skipped', durationMs: 0 },
      ],
    };
    render(<ZerouVerifyStrip verify={verify} />);
    expect(screen.getByTestId('zerou-verify-overall')).toHaveTextContent(/broken by tsc/);
  });
});
