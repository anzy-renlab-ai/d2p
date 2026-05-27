import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZerouStageVerify } from './ZerouStageVerify.js';
import { mockZerouBundle } from '../mock/zerouBundle.js';

describe('ZerouStageVerify', () => {
  it('renders chip for each verify step', () => {
    render(<ZerouStageVerify bundle={mockZerouBundle} />);
    fireEvent.click(screen.getByTestId('zerou-stage-verify-header'));
    const chips = screen.getByTestId('zerou-stage-verify-chips');
    expect(chips).toBeInTheDocument();
    expect(screen.getByTestId('zerou-stage-verify-step-install')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-stage-verify-step-tsc')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-stage-verify-step-test')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-stage-verify-step-build')).toBeInTheDocument();
  });

  it('marks status=done when bundle.verify.ok is true', () => {
    render(<ZerouStageVerify bundle={mockZerouBundle} />);
    const card = screen.getByTestId('zerou-stage-verify');
    expect(card.getAttribute('data-stage-status')).toBe('done');
  });
});
