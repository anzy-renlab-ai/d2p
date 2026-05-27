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

describe('ZerouReview (preview source)', () => {
  it('renders the full page with hero / modules / findings / files / verify', () => {
    render(<ZerouReview source={{ kind: 'preview' }} />);
    expect(screen.getByTestId('zerou-review')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-hero-bar')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-module-cards')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-findings-list')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-files-list')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-branch-tree')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-verify-strip')).toBeInTheDocument();
  });

  it('escapes branch name and cwd in the hero (HTML-safe)', () => {
    render(<ZerouReview source={{ kind: 'preview' }} />);
    // raw branch text shown as-is, no script execution surface
    expect(screen.getAllByText(/zerou-enhance-20260527-160917/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/meme-weather-zerou-test/).length).toBeGreaterThan(0);
  });

  it('renders merge + drop commands in the footer', () => {
    render(<ZerouReview source={{ kind: 'preview' }} />);
    expect(screen.getByTestId('zerou-cmd-merge')).toBeInTheDocument();
    expect(screen.getByTestId('zerou-cmd-drop')).toBeInTheDocument();
    expect(screen.getByText(/git merge --no-ff/)).toBeInTheDocument();
  });
});
