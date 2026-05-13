import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HealthBadge } from './HealthBadge.js';
import { useStore } from '../store.js';

beforeEach(() => {
  useStore.setState({ health: null, sseConnected: false });
});

describe('HealthBadge', () => {
  it('shows daemon down when health is null', () => {
    render(<HealthBadge />);
    expect(screen.getByText(/daemon down/)).toBeInTheDocument();
  });

  it('shows degraded when daemon is up but ok=false', () => {
    useStore.setState({
      health: {
        ok: false,
        daemonVersion: '0.1.0',
        promptsVersion: 1,
        claudeCli: { found: false, version: null },
        gitCli: { found: true, version: 'git 2.51' },
        dbPath: 'C:\\fake',
        uptimeMs: 1000,
      },
      sseConnected: false,
    });
    render(<HealthBadge />);
    expect(screen.getByText(/degraded/)).toBeInTheDocument();
  });

  it('shows healthy + stream connected when both ok', () => {
    useStore.setState({
      health: {
        ok: true,
        daemonVersion: '0.1.0',
        promptsVersion: 1,
        claudeCli: { found: true, version: 'claude 2.1' },
        gitCli: { found: true, version: 'git 2.51' },
        dbPath: 'C:\\fake',
        uptimeMs: 1000,
      },
      sseConnected: true,
    });
    render(<HealthBadge />);
    expect(screen.getByText(/healthy/)).toBeInTheDocument();
    expect(screen.getByText(/stream/)).toBeInTheDocument();
  });
});
