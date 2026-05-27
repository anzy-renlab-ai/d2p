import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ZerouFindingsList } from './ZerouFindingsList.js';
import { mockZerouBundle } from '../mock/zerouBundle.js';

describe('ZerouFindingsList', () => {
  it('groups findings by severity P1/P2/P3', () => {
    render(<ZerouFindingsList findings={mockZerouBundle.findings} />);
    expect(screen.getByTestId('zerou-findings-group-P1')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-findings-group-P2')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-findings-group-P3')).toBeInTheDocument();
  });

  it('shows correct count per severity header', () => {
    render(<ZerouFindingsList findings={mockZerouBundle.findings} />);
    const p1Group = screen.getByTestId('zerou-findings-group-P1');
    // 10 P1 findings in mock
    expect(within(p1Group).getByText(/P1 · 10/)).toBeInTheDocument();
  });

  it('expands a finding row inline on click and shows expected/actual', () => {
    render(<ZerouFindingsList findings={mockZerouBundle.findings} />);
    const firstRow = screen.getByTestId('zerou-finding-row-f-0');
    fireEvent.click(firstRow);
    expect(screen.getByText(/expected/i)).toBeInTheDocument();
    expect(screen.getByText(/actual/i)).toBeInTheDocument();
  });

  it('renders empty state when no findings', () => {
    render(<ZerouFindingsList findings={[]} />);
    expect(screen.getByText(/No findings/)).toBeInTheDocument();
  });
});
