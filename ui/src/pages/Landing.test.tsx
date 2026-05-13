import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Landing } from './Landing.js';
import { useStore } from '../store.js';

beforeEach(() => {
  useStore.setState({
    health: {
      ok: true,
      daemonVersion: '0.1.0',
      promptsVersion: 1,
      claudeCli: { found: true, version: 'claude 2.1' },
      gitCli: { found: true, version: 'git 2.51' },
      dbPath: 'x',
      uptimeMs: 100,
    },
    healthError: null,
    startSession: vi.fn(async () => {}),
  });
});

describe('Landing', () => {
  it('renders d2p heading and start button', () => {
    render(<Landing />);
    expect(screen.getByRole('heading', { name: 'd2p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start session/ })).toBeInTheDocument();
  });

  it('refuses empty path', () => {
    render(<Landing />);
    fireEvent.click(screen.getByRole('button', { name: /Start session/ }));
    expect(screen.getByText(/请填一个绝对路径/)).toBeInTheDocument();
  });

  it('calls startSession with the typed path', async () => {
    const startSession = vi.fn(async () => {});
    useStore.setState({ startSession });
    render(<Landing />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'C:\\demos\\thing' } });
    fireEvent.click(screen.getByRole('button', { name: /Start session/ }));
    // Wait microtask
    await new Promise((r) => setTimeout(r, 10));
    expect(startSession).toHaveBeenCalledWith('C:\\demos\\thing');
  });

  it('surfaces daemon-down banner when healthError set', () => {
    useStore.setState({ health: null, healthError: 'connection refused' });
    render(<Landing />);
    expect(screen.getByText(/连不上 daemon/)).toBeInTheDocument();
  });

  it('warns when claude CLI missing', () => {
    useStore.setState({
      health: {
        ok: false,
        daemonVersion: '0.1.0',
        promptsVersion: 1,
        claudeCli: { found: false, version: null },
        gitCli: { found: true, version: 'git 2.51' },
        dbPath: 'x',
        uptimeMs: 100,
      },
    });
    render(<Landing />);
    expect(screen.getByText(/没找到/)).toBeInTheDocument();
  });
});
