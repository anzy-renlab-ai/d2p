import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ZerouHeroBar } from './ZerouHeroBar.js';
import { mockZerouBundle } from '../mock/zerouBundle.js';

describe('ZerouHeroBar', () => {
  it('renders project name and run timestamp', () => {
    render(<ZerouHeroBar bundle={mockZerouBundle} />);
    expect(screen.getByText('meme-weather')).toBeInTheDocument();
    // runTs appears in both the branch name and the run badge — assert at
    // least one match rather than uniqueness.
    expect(screen.getAllByText(/20260527-160917/).length).toBeGreaterThan(0);
  });

  it('shows derived +additions / -deletions from files', () => {
    render(<ZerouHeroBar bundle={mockZerouBundle} />);
    const additions = mockZerouBundle.files.reduce((s, f) => s + f.additions, 0);
    const deletions = mockZerouBundle.files.reduce((s, f) => s + f.deletions, 0);
    expect(screen.getByText(`+${additions}`)).toBeInTheDocument();
    expect(screen.getByText(`-${deletions}`)).toBeInTheDocument();
  });

  it('shows findings + self-deceiving counts', () => {
    render(<ZerouHeroBar bundle={mockZerouBundle} />);
    // 38 findings
    expect(screen.getByText('38')).toBeInTheDocument();
    // self-deceiving label is present
    expect(screen.getByText('self-deceiving')).toBeInTheDocument();
  });

  it('formats duration into "m s" form', () => {
    render(<ZerouHeroBar bundle={mockZerouBundle} />);
    // 242_000 ms = 4m 02s
    expect(screen.getByText(/4m 02s/)).toBeInTheDocument();
  });
});
