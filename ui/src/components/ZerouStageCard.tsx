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

const STATUS_GLYPH: Record<StageStatus, { glyph: string; tone: string; ring: string; anim?: string }> = {
  pending: { glyph: '◌', tone: 'text-muted/60',  ring: 'ring-warmline' },
  running: { glyph: '◐', tone: 'text-coral',     ring: 'ring-coral/40', anim: 'anim-tick' },
  done:    { glyph: '✓', tone: 'text-forest',    ring: 'ring-forest/30' },
  fail:    { glyph: '✗', tone: 'text-rust',      ring: 'ring-rust/40' },
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
      className={`bg-cream border border-warmline rounded-lg overflow-hidden ring-1 ${meta.ring}`}
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
        <span className="text-coral font-serif text-2xl leading-none flex-shrink-0 w-7 text-center">
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
          className={`text-xl leading-none flex-shrink-0 ${meta.tone} ${meta.anim ?? ''}`}
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
