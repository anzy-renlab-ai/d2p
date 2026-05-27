import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZerouFilesList } from './ZerouFilesList.js';
import { mockZerouBundle } from '../mock/zerouBundle.js';

describe('ZerouFilesList', () => {
  it('renders one row per file', () => {
    render(<ZerouFilesList files={mockZerouBundle.files} />);
    // 12 files in mock
    expect(screen.getAllByText(/src\/|app\/|next\.config|middleware|\.env/).length).toBeGreaterThan(0);
  });

  it('opens diff drawer when a row is clicked', () => {
    render(<ZerouFilesList files={mockZerouBundle.files} />);
    const firstRow = screen.getByTestId('zerou-file-row-src-logger-ts');
    fireEvent.click(firstRow);
    expect(screen.getByTestId('zerou-file-drawer')).toBeInTheDocument();
  });

  it('closes drawer when scrim is clicked', () => {
    render(<ZerouFilesList files={mockZerouBundle.files} />);
    fireEvent.click(screen.getByTestId('zerou-file-row-src-logger-ts'));
    const drawer = screen.getByTestId('zerou-file-drawer');
    fireEvent.click(drawer);
    expect(screen.queryByTestId('zerou-file-drawer')).not.toBeInTheDocument();
  });

  it('renders empty state with zero files', () => {
    render(<ZerouFilesList files={[]} />);
    expect(screen.getByText(/No files changed/)).toBeInTheDocument();
  });
});
