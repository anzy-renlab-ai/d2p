import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ZerouModuleCards } from './ZerouModuleCards.js';
import { mockZerouBundle } from '../mock/zerouBundle.js';

describe('ZerouModuleCards', () => {
  it('renders one card per module', () => {
    render(<ZerouModuleCards modules={mockZerouBundle.modules} />);
    for (const m of mockZerouBundle.modules) {
      expect(screen.getByTestId(`zerou-module-card-${m.id}`)).toBeInTheDocument();
    }
  });

  it('shows files-touched count when present', () => {
    render(<ZerouModuleCards modules={mockZerouBundle.modules} />);
    const sentry = screen.getByTestId('zerou-module-card-sentry');
    expect(sentry).toHaveTextContent(/4 files/);
  });

  it('renders the module label and short summary', () => {
    render(<ZerouModuleCards modules={mockZerouBundle.modules} />);
    const logging = screen.getByTestId('zerou-module-card-logging');
    expect(logging).toHaveTextContent(/Logging/);
    expect(logging).toHaveTextContent(/pino/);
  });
});
