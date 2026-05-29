import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZerouStageCard } from './ZerouStageCard.js';

describe('ZerouStageCard', () => {
  it('renders numeral, title, metric, and status glyph', () => {
    render(
      <ZerouStageCard
        numeral="①"
        title="扫"
        metric="72 fns"
        status="done"
        testId="zerou-stage-test-card"
      >
        <div>body</div>
      </ZerouStageCard>,
    );
    expect(screen.getByText('①')).toBeInTheDocument();
    expect(screen.getByText('扫')).toBeInTheDocument();
    expect(screen.getByText('72 fns')).toBeInTheDocument();
    // glyph ✓ for status=done
    expect(screen.getByLabelText('done')).toHaveTextContent('✓');
  });

  it('toggles body open and closed on header click', () => {
    render(
      <ZerouStageCard
        numeral="②"
        title="测"
        metric="m"
        status="done"
        testId="zerou-card-toggle"
      >
        <div>hidden-body-text</div>
      </ZerouStageCard>,
    );
    expect(screen.queryByText('hidden-body-text')).toBeNull();
    fireEvent.click(screen.getByTestId('zerou-card-toggle-header'));
    expect(screen.getByText('hidden-body-text')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('zerou-card-toggle-header'));
    expect(screen.queryByText('hidden-body-text')).toBeNull();
  });

  it('defaultOpen=true keeps body open initially', () => {
    render(
      <ZerouStageCard
        numeral="⑤"
        title="追溯"
        metric="m"
        status="done"
        defaultOpen
        testId="zerou-card-default-open"
      >
        <div>centerpiece-body</div>
      </ZerouStageCard>,
    );
    expect(screen.getByText('centerpiece-body')).toBeInTheDocument();
  });

  it('running status shows status-pulse animation class', () => {
    render(
      <ZerouStageCard
        numeral="③"
        title="改"
        metric="m"
        status="running"
        testId="zerou-card-running"
      >
        <div />
      </ZerouStageCard>,
    );
    const glyph = screen.getByLabelText('running');
    expect(glyph.className).toMatch(/anim-status-pulse/);
  });
});
