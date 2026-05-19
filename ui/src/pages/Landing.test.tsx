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
    locale: 'zh',
    startSession: vi.fn(async () => {}),
  });
});

describe('Landing', () => {
  it('renders ZeroU heading and at least one 新建项目 button', () => {
    render(<Landing />);
    expect(screen.getByRole('heading', { name: 'ZeroU' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /新建项目/ }).length).toBeGreaterThan(0);
  });

  it('refuses empty path in the add-project modal', () => {
    render(<Landing />);
    // Click the header "新建项目" — first button with that name.
    fireEvent.click(screen.getAllByRole('button', { name: /新建项目/ })[0]!);
    fireEvent.click(screen.getByRole('button', { name: /开始/ }));
    expect(screen.getByText(/请填一个绝对路径/)).toBeInTheDocument();
  });

  it('calls startSession with the typed path from the modal', async () => {
    const startSession = vi.fn(async () => {});
    useStore.setState({ startSession });
    render(<Landing />);
    fireEvent.click(screen.getAllByRole('button', { name: /新建项目/ })[0]!);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'C:\\demos\\thing' } });
    fireEvent.click(screen.getByRole('button', { name: /开始/ }));
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
