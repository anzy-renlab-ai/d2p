import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZerouBranchTree } from './ZerouBranchTree.js';
import { mockZerouBundle } from '../mock/zerouBundle.js';

describe('ZerouBranchTree', () => {
  it('shows total function and risk counts in the header', () => {
    render(<ZerouBranchTree report={mockZerouBundle.branchCoverage} />);
    expect(screen.getByText(/72 fns/)).toBeInTheDocument();
    // self-deceiving label can appear in header + per-row badges; assert at least one.
    expect(screen.getAllByText(/self-deceiving/).length).toBeGreaterThan(0);
  });

  it('filters function rows when filter changes to "self-deceiving"', () => {
    render(<ZerouBranchTree report={mockZerouBundle.branchCoverage} />);
    const select = screen.getByTestId('zerou-branch-filter') as HTMLSelectElement;
    const allBefore = screen.getAllByTestId(/zerou-branch-fn-/).length;
    fireEvent.change(select, { target: { value: 'self-deceiving' } });
    const allAfter = screen.getAllByTestId(/zerou-branch-fn-/).length;
    expect(allAfter).toBeLessThan(allBefore);
    expect(allAfter).toBe(
      mockZerouBundle.branchCoverage!.functions.filter((f) => f.selfDeceivingCount > 0).length
    );
  });

  it('renders ASCII tree when a function row is expanded', () => {
    render(<ZerouBranchTree report={mockZerouBundle.branchCoverage} />);
    const first = screen.getByTestId('zerou-branch-fn-fn-0');
    fireEvent.click(first);
    // ascii tree includes try block label
    expect(screen.getByText(/try \{ … \} catch \{ … \}/)).toBeInTheDocument();
  });

  it('renders unavailable state when report is null', () => {
    render(<ZerouBranchTree report={null} />);
    expect(screen.getByText(/Branch coverage unavailable/)).toBeInTheDocument();
  });
});
