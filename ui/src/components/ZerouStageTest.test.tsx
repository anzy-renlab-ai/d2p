import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZerouStageTest } from './ZerouStageTest.js';
import { mockZerouBundle } from '../mock/zerouBundle.js';

describe('ZerouStageTest', () => {
  it('renders pass / fail counts from audit', () => {
    render(<ZerouStageTest bundle={mockZerouBundle} />);
    expect(screen.getByText(/33 pass/)).toBeInTheDocument();
    expect(screen.getByText(/33 fail/)).toBeInTheDocument();
  });

  it('shows verdict distribution when expanded', () => {
    render(<ZerouStageTest bundle={mockZerouBundle} />);
    fireEvent.click(screen.getByTestId('zerou-stage-test-header'));
    expect(screen.getByTestId('zerou-stage-test-verdicts')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-stage-test-verdict-covered')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-stage-test-verdict-untested')).toBeInTheDocument();
  });
});
