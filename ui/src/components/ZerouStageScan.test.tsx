import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZerouStageScan } from './ZerouStageScan.js';
import { mockZerouBundle } from '../mock/zerouBundle.js';

describe('ZerouStageScan', () => {
  it('renders the function + branch totals from branchCoverage', () => {
    render(<ZerouStageScan bundle={mockZerouBundle} />);
    // 72 fns · 216 branches in the header metric
    const total = mockZerouBundle.branchCoverage!.summary.branchesTotal;
    expect(screen.getByTestId('zerou-stage-scan')).toBeInTheDocument();
    // Match the metric text in the collapsed header (multiple "72" possible)
    expect(screen.getAllByText(/72/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(`${total}`)).length).toBeGreaterThan(0);
  });

  it('expands to show the dir bucket histogram', () => {
    render(<ZerouStageScan bundle={mockZerouBundle} />);
    // Closed initially — the dir list is hidden.
    expect(screen.queryByTestId('zerou-stage-scan-dirs')).toBeNull();
    fireEvent.click(screen.getByTestId('zerou-stage-scan-header'));
    expect(screen.getByTestId('zerou-stage-scan-dirs')).toBeInTheDocument();
    // app/api should be the top dir for our mock — every function lives there.
    expect(screen.getByText('app/api/')).toBeInTheDocument();
  });
});
