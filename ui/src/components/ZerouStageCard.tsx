import { useState, type ReactNode } from 'react';
import type { StageStatus } from '../types-zerou.js';

/**
 * Reusable expandable stage card used by Stage ①–⑤ on the review page.
 *
 * Always-visible header: stage glyph + numeral + title + key metric + status.
 * Click anywhere on the header to expand/collapse the detail body. Body
 * mounts only when open (`details`-style) so heavy sub-trees stay cheap until
 * the user opens them.
 */

const STATUS_GLYPH: Record<
  StageStatus,
  {
    glyph: string;
    tone: string;
    ring: string;
    /** Numeral-circle border colour (status-driven). */
    numBorder: string;
    /** Numeral text colour. */
    numTone: string;
    /** Card border + faint tint when the stage demands attention (fail). */
    card: string;
    anim?: string;
  }
> = {
  pending: {
    glyph: '◌',
    tone: 'text-muted/60',
    ring: 'ring-warmline',
    numBorder: 'border-warmline',
    numTone: 'text-muted/60',
    card: 'border-warmline',
  },
  running: {
    glyph: '◐',
    tone: 'text-electric',
    ring: 'ring-electric/40',
    numBorder: 'border-electric',
    numTone: 'text-electric',
    card: 'border-warmline',
    anim: 'anim-status-pulse',
  },
  done: {
    glyph: '✓',
    tone: 'text-forest',
    ring: 'ring-forest/30',
    numBorder: 'border-forest',
    numTone: 'text-forest',
    card: 'border-warmline',
  },
  fail: {
    glyph: '✗',
    tone: 'text-rust',
    ring: 'ring-rust/40',
    numBorder: 'border-rust',
    numTone: 'text-rust',
    card: 'border-rust/40 bg-rust/5',
  },
};

export interface ZerouStageCardProps {
  numeral: '①' | '②' | '③' | '④' | '⑤';
  title: string;
  metric: ReactNode;
  status: StageStatus;
  /** Free-text sub-line under the metric (e.g. "33 pass · 33 fail"). */
  subMetric?: ReactNode;
  /** Defaults to closed for stages ①–④; centerpiece stage ⑤ opens by default. */
  defaultOpen?: boolean;
  /** Test id for the outer section. */
  testId: string;
  children: ReactNode;
}

export function ZerouStageCard({
  numeral,
  title,
  metric,
  status,
  subMetric,
  defaultOpen = false,
  testId,
  children,
}: ZerouStageCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const meta = STATUS_GLYPH[status];

  return (
    <section
      className={`bg-cream border ${meta.card} rounded-lg overflow-hidden ring-1 ${meta.ring}`}
      data-testid={testId}
      data-stage-status={status}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full text-left px-5 py-3 flex items-center gap-4 hover:bg-paper transition-colors"
        data-testid={`${testId}-header`}
        aria-expanded={open}
      >
        <span
          className={`font-serif text-lg leading-none flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full border-2 ${meta.numBorder} ${meta.numTone} ${status === 'running' ? meta.anim ?? '' : ''}`}
        >
          {numeral}
        </span>
        <span className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-sm font-medium text-ink font-sans">{title}</span>
            <span className="text-xs text-muted font-mono">{metric}</span>
          </div>
          {subMetric && (
            <div className="text-[11px] text-muted/80 font-mono mt-0.5">{subMetric}</div>
          )}
        </span>
        <span
          className={`text-2xl font-bold leading-none flex-shrink-0 ${meta.tone} ${meta.anim ?? ''}`}
          aria-label={status}
        >
          {meta.glyph}
        </span>
        <span className="text-xs text-muted/60 flex-shrink-0 ml-1" aria-hidden="true">
          {open ? '▾' : '›'}
        </span>
      </button>
      {open && (
        <div
          className="border-t border-warmline anim-drift-in"
          data-testid={`${testId}-body`}
        >
          {children}
        </div>
      )}
    </section>
  );
}
