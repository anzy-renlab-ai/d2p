import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ZerouReview, readReviewParam } from './ZerouReview.js';

const origLocation = window.location;

function setLocationSearch(search: string) {
  // jsdom location is read-only via property; redefine.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...origLocation, search, reload: () => undefined } as Location,
  });
}

describe('readReviewParam', () => {
  beforeEach(() => setLocationSearch(''));
  afterEach(() => setLocationSearch(''));

  it('returns null when no ?review= is set', () => {
    expect(readReviewParam()).toBeNull();
  });

  it('returns preview source for ?review=preview', () => {
    setLocationSearch('?review=preview');
    expect(readReviewParam()).toEqual({ kind: 'preview' });
  });

  it('returns latest source for ?review=latest', () => {
    setLocationSearch('?review=latest');
    expect(readReviewParam()).toEqual({ kind: 'latest' });
  });

  it('returns runTs source for an arbitrary value', () => {
    setLocationSearch('?review=20260527-160917');
    expect(readReviewParam()).toEqual({ kind: 'runTs', runTs: '20260527-160917' });
  });
});

describe('ZerouReview (5-stage pipeline · preview source)', () => {
  it('renders all 5 pipeline stages from the preview bundle', () => {
    render(<ZerouReview source={{ kind: 'preview' }} />);
    expect(screen.getByTestId('zerou-review')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-stage-scan')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-stage-test')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-stage-fix')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-stage-verify')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-stage-trace')).toBeInTheDocument();
  });

  it('shows the centerpiece tree-log inside stage ⑤ (default-open)', () => {
    render(<ZerouReview source={{ kind: 'preview' }} />);
    // Stage 5 opens by default so its body and tree-log are mounted.
    expect(screen.getByTestId('zerou-stage-trace-body')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-branch-tree-log')).toBeInTheDocument();
  });

  it('shows project identity strip with cwd, branch, runTs', () => {
    render(<ZerouReview source={{ kind: 'preview' }} />);
    expect(screen.getAllByText(/zerou-enhance-20260527-160917/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/meme-weather-zerou-test/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/20260527-160917/).length).toBeGreaterThan(0);
  });

  it('renders merge + drop commands in the footer', () => {
    render(<ZerouReview source={{ kind: 'preview' }} />);
    expect(screen.getByTestId('zerou-cmd-merge')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-cmd-drop')).toBeInTheDocument();
    expect(screen.getByText(/git merge --no-ff/)).toBeInTheDocument();
  });

  it('shows the pipeline status summary in the sticky header', () => {
    render(<ZerouReview source={{ kind: 'preview' }} />);
    expect(screen.getByTestId('zerou-review-stage-summary')).toBeInTheDocument();
  });
});
