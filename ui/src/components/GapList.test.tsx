import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GapList } from './GapList.js';
import { useStore } from '../store.js';
import type { Gap } from '../types.js';

function fakeGap(over: Partial<Gap> = {}): Gap {
  return {
    id: 1,
    sessionId: 1,
    slug: 'add-auth',
    title: 'Add login',
    body: 'detail',
    category: 'auth',
    severity: 'P1',
    source: 'preset',
    suggestedApproach: '',
    expectedFilesChanged: ['src/auth.ts'],
    status: 'PENDING',
    dynamicK: null,
    parentGapId: null,
    createdAt: 0,
    finishedAt: null,
    ...over,
  };
}

beforeEach(() => {
  useStore.setState({ gaps: [], skipGap: vi.fn(async () => {}), locale: 'zh' });
});

describe('GapList', () => {
  it('shows empty hint when no gaps', () => {
    render(<GapList />);
    expect(screen.getByText(/还没找出来要补什么/)).toBeInTheDocument();
  });

  it('groups by status', () => {
    useStore.setState({
      gaps: [
        fakeGap({ id: 1, slug: 'a', status: 'PENDING', title: 'A' }),
        fakeGap({ id: 2, slug: 'b', status: 'IN_PROGRESS', title: 'B' }),
        fakeGap({ id: 3, slug: 'c', status: 'DONE', title: 'C' }),
      ],
    });
    render(<GapList />);
    expect(screen.getByText(/处理中/)).toBeInTheDocument();
    expect(screen.getByText(/待处理/)).toBeInTheDocument();
    expect(screen.getByText(/完成/)).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('click on title expands detail', () => {
    useStore.setState({ gaps: [fakeGap({ id: 9, slug: 'auth-x', title: 'Click me', body: 'detail-body' })] });
    render(<GapList />);
    expect(screen.queryByText('detail-body')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Click me'));
    expect(screen.getByText('detail-body')).toBeInTheDocument();
  });

  it('skip button calls store.skipGap', () => {
    const skipGap = vi.fn(async () => {});
    useStore.setState({
      gaps: [fakeGap({ id: 42, slug: 'p', title: 'P', status: 'PENDING' })],
      skipGap,
    });
    render(<GapList />);
    fireEvent.click(screen.getByRole('button', { name: '跳过' }));
    expect(skipGap).toHaveBeenCalledWith(42);
  });
});
