import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MultiTurnPanel } from './MultiTurnPanel.js';
import { useStore } from '../store.js';
import {
  mockMultiTurnIdle,
  mockMultiTurnRunning,
  mockMultiTurnFinalizing,
  mockMultiTurnDone,
  mockMultiTurnPaused,
} from '../mock/multiTurn.js';

beforeEach(() => {
  useStore.setState({ multiTurn: null });
});

describe('MultiTurnPanel — narrative-first layout', () => {
  it('renders nothing when no multi-turn state', () => {
    useStore.setState({ multiTurn: null });
    const { container } = render(<MultiTurnPanel />);
    expect(container.querySelector('[data-testid="multi-turn-panel"]')).toBeNull();
  });

  it('renders nothing for idle phase', () => {
    useStore.setState({ multiTurn: mockMultiTurnIdle });
    const { container } = render(<MultiTurnPanel />);
    expect(container.querySelector('[data-testid="multi-turn-panel"]')).toBeNull();
  });

  it('renders nothing for simple complexity', () => {
    useStore.setState({
      multiTurn: { ...mockMultiTurnRunning, complexity: 'simple' },
    });
    const { container } = render(<MultiTurnPanel />);
    expect(container.querySelector('[data-testid="multi-turn-panel"]')).toBeNull();
  });

  it('running state — headline says d2p 正在帮你修', () => {
    useStore.setState({ multiTurn: mockMultiTurnRunning });
    render(<MultiTurnPanel />);
    const headline = screen.getByTestId('multi-turn-headline');
    expect(headline.textContent).toMatch(/d2p 正在帮你修/);
  });

  it('running state — gap title visible in 任务 line', () => {
    useStore.setState({ multiTurn: mockMultiTurnRunning });
    render(<MultiTurnPanel />);
    expect(screen.getByTestId('multi-turn-gap')).toHaveTextContent(mockMultiTurnRunning.gapTitle);
  });

  it('running state — verdict tells user what to do', () => {
    useStore.setState({ multiTurn: mockMultiTurnRunning });
    render(<MultiTurnPanel />);
    expect(screen.getByTestId('multi-turn-verdict')).toBeInTheDocument();
  });

  it('running state — actions show 暂停 + 中止', () => {
    useStore.setState({ multiTurn: mockMultiTurnRunning });
    render(<MultiTurnPanel />);
    expect(screen.getByRole('button', { name: /暂停/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /中止/ })).toBeInTheDocument();
  });

  it('paused state — verdict gives 继续 / 中止 options', () => {
    useStore.setState({ multiTurn: mockMultiTurnPaused });
    render(<MultiTurnPanel />);
    expect(screen.getByTestId('multi-turn-headline')).toHaveTextContent(/d2p 暂停/);
    expect(screen.getByRole('button', { name: /继续/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /中止/ })).toBeInTheDocument();
  });

  it('finalizing state — headline says 写完了 + reviewer 验证', () => {
    useStore.setState({ multiTurn: mockMultiTurnFinalizing });
    render(<MultiTurnPanel />);
    expect(screen.getByTestId('multi-turn-headline')).toHaveTextContent(/写完了/);
    expect(screen.getByTestId('multi-turn-verdict')).toHaveTextContent(/reviewer/);
  });

  it('done state — headline says 修完了 + 看改动 button', () => {
    useStore.setState({ multiTurn: mockMultiTurnDone });
    render(<MultiTurnPanel />);
    expect(screen.getByTestId('multi-turn-headline')).toHaveTextContent(/修完了/);
    expect(screen.getByTestId('multi-turn-verdict')).toHaveTextContent(/合并到 main/);
    expect(screen.getByRole('button', { name: /看改动/ })).toBeInTheDocument();
  });

  it('details collapsed by default — scratchpad hidden', () => {
    useStore.setState({ multiTurn: mockMultiTurnRunning });
    render(<MultiTurnPanel />);
    expect(screen.queryByTestId('multi-turn-scratchpad')).toBeNull();
  });

  it('clicking 展开细节 reveals scratchpad + token + $ stats', () => {
    useStore.setState({ multiTurn: mockMultiTurnRunning });
    render(<MultiTurnPanel />);
    fireEvent.click(screen.getByTestId('multi-turn-details-toggle'));
    expect(screen.getByTestId('multi-turn-scratchpad')).toBeInTheDocument();
    expect(screen.getByText(/估算花费/)).toBeInTheDocument();
  });

  it('scratchpad shows newest-first', () => {
    useStore.setState({ multiTurn: mockMultiTurnRunning });
    render(<MultiTurnPanel />);
    fireEvent.click(screen.getByTestId('multi-turn-details-toggle'));
    const pad = screen.getByTestId('multi-turn-scratchpad');
    const items = pad.querySelectorAll('li');
    const last =
      mockMultiTurnRunning.scratchpad[mockMultiTurnRunning.scratchpad.length - 1]!;
    expect(items[0]).toHaveTextContent(last.text);
  });

  it('health dot present + pulses on running', () => {
    useStore.setState({ multiTurn: mockMultiTurnRunning });
    render(<MultiTurnPanel />);
    const dot = screen.getByTestId('multi-turn-health-dot');
    expect(dot).toBeInTheDocument();
    expect(dot.className).toMatch(/animate-pulse/);
  });

  it('progress bar visible when running, not when done', () => {
    useStore.setState({ multiTurn: mockMultiTurnRunning });
    const { rerender } = render(<MultiTurnPanel />);
    expect(screen.getByTestId('multi-turn-progress-bar')).toBeInTheDocument();
    useStore.setState({ multiTurn: mockMultiTurnDone });
    rerender(<MultiTurnPanel />);
    expect(screen.queryByTestId('multi-turn-progress-bar')).toBeNull();
  });

  it('health band turns yellow when over 60% of time/turn cap', () => {
    useStore.setState({
      multiTurn: {
        ...mockMultiTurnRunning,
        currentTurn: 9,
        maxTurns: 12, // 75%
      },
    });
    render(<MultiTurnPanel />);
    expect(screen.getByTestId('multi-turn-verdict')).toHaveTextContent(/久了|暂停看看/);
  });

  it('renders turn timeline with one entry per turn', () => {
    useStore.setState({ multiTurn: mockMultiTurnRunning });
    render(<MultiTurnPanel />);
    expect(screen.getByTestId('multi-turn-timeline')).toBeInTheDocument();
    for (const t of mockMultiTurnRunning.turns) {
      expect(screen.getByTestId(`multi-turn-step-${t.index}`)).toBeInTheDocument();
    }
  });

  it('latest turn in timeline shows 进行中 when status is running', () => {
    useStore.setState({ multiTurn: mockMultiTurnRunning });
    render(<MultiTurnPanel />);
    const lastTurn = mockMultiTurnRunning.turns[mockMultiTurnRunning.turns.length - 1]!;
    const step = screen.getByTestId(`multi-turn-step-${lastTurn.index}`);
    expect(step).toHaveTextContent('进行中');
  });

  it('back button calls onBackToGaps prop when clicked', () => {
    useStore.setState({ multiTurn: mockMultiTurnRunning });
    let clicked = false;
    render(<MultiTurnPanel onBackToGaps={() => { clicked = true; }} />);
    fireEvent.click(screen.getByTestId('multi-turn-back-to-gaps'));
    expect(clicked).toBe(true);
  });

  it('health band turns red when over 85% — verdict suggests stop', () => {
    useStore.setState({
      multiTurn: {
        ...mockMultiTurnRunning,
        currentTurn: 11,
        maxTurns: 12, // 92%
      },
    });
    render(<MultiTurnPanel />);
    expect(screen.getByTestId('multi-turn-headline')).toHaveTextContent(/卡住/);
    expect(screen.getByTestId('multi-turn-verdict')).toHaveTextContent(/上限|浪费/);
  });
});
