import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZerouStageFix } from './ZerouStageFix.js';
import { mockZerouBundle } from '../mock/zerouBundle.js';

describe('ZerouStageFix', () => {
  it('renders module + finding counts in header metric', () => {
    render(<ZerouStageFix bundle={mockZerouBundle} />);
    const metricText = `${mockZerouBundle.files.length}`;
    expect(screen.getAllByText(metricText).length).toBeGreaterThan(0);
    expect(screen.getAllByText(`${mockZerouBundle.findings.length}`).length).toBeGreaterThan(0);
  });

  it('switches between Modules / Files / Findings tabs when expanded', () => {
    render(<ZerouStageFix bundle={mockZerouBundle} />);
    fireEvent.click(screen.getByTestId('zerou-stage-fix-header'));
    // Default tab is modules.
    expect(screen.getByTestId('zerou-module-cards')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('zerou-stage-fix-tab-files'));
    expect(screen.getByTestId('zerou-files-list')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('zerou-stage-fix-tab-findings'));
    expect(screen.getByTestId('zerou-findings-list')).toBeInTheDocument();
  });
});
