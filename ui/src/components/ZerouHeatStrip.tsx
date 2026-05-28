import { useMemo, useState } from 'react';
import {
  aggregateFileState,
  STATE_BG,
  STATE_LABEL,
  STATE_OVERLAY,
  type BranchTraceEventLite,
  type FileStateBreakdown,
} from '../lib/branchState.js';

/**
 * ZerouHeatStrip — top-of-trace project heatmap.
 *
 * One square per file. Each square reflects the file's aggregate live
 * state. Mixed files render as a horizontal stripe gradient so the user
 * can see the green/red ratio at a glance.
 *
 * Click → tells the parent to scroll to + expand that file in the tree.
 * Hover → tooltip with file path + counts.
 */

export interface ZerouHeatStripProps {
  events: BranchTraceEventLite[];
  /** Fired when user clicks a square. Parent should scroll the tree to
   *  the file and ensure its ancestors are expanded. */
  onJumpToFile?(filePath: string): void;
}

interface FileSquare {
  path: string;
  shortName: string;
  breakdown: FileStateBreakdown;
}

function groupByFile(events: BranchTraceEventLite[]): FileSquare[] {
  const m = new Map<string, BranchTraceEventLite[]>();
  for (const ev of events) {
    const k = ev['code.file.path'];
    let arr = m.get(k);
    if (!arr) { arr = []; m.set(k, arr); }
    arr.push(ev);
  }
  const out: FileSquare[] = [];
  for (const [path, evs] of m.entries()) {
    const segs = path.split(/[\\/]/);
    out.push({
      path,
      shortName: segs[segs.length - 1] ?? path,
      breakdown: aggregateFileState(evs),
    });
  }
  // Sort: business-red files first, then mechanical-red, then mixed, then
  // covered, then pending. Bubbles attention-needing files to the left.
  const RANK: Record<string, number> = {
    'business-red': 0,
    'mechanical-red': 1,
    mixed: 2,
    retrying: 3,
    evaluating: 4,
    pending: 5,
    covered: 6,
  };
  out.sort((a, b) => {
    const ra = RANK[a.breakdown.aggregate] ?? 99;
    const rb = RANK[b.breakdown.aggregate] ?? 99;
    if (ra !== rb) return ra - rb;
    return a.path.localeCompare(b.path);
  });
  return out;
}

function squareBackground(b: FileStateBreakdown): string | undefined {
  // For non-mixed aggregates we return undefined → Tailwind class supplies
  // the solid colour via STATE_BG. For mixed we return a CSS linear-gradient
  // built from the proportions.
  if (b.aggregate !== 'mixed') return undefined;
  if (b.total === 0) return undefined;

  // Colour stops, in fixed paint order (red flavours leftmost so they're
  // the loud part of the bar):
  //   business-red → rust       (#B23A48)
  //   mechanical-red → rust 70% (#B23A48 with .7 opacity layered atop coral
  //                              soft so it reads as a softer red)
  //   retrying     → coral 60%  (#C96442 .6)
  //   evaluating   → coral      (#C96442)
  //   pending      → muted/20
  //   covered      → forest     (#587A4C)
  const raw: Array<[string, number]> = [
    ['#B23A48', b.businessRed],
    ['#B23A48BB', b.mechanicalRed], // semi-transparent for visual distinction
    ['#C96442', b.retrying + b.evaluating],
    ['#9C9A93', b.pending],
    ['#587A4C', b.covered],
  ];
  const slices = raw.filter((entry) => entry[1] > 0);

  let cursor = 0;
  const stops: string[] = [];
  for (const [colour, n] of slices) {
    const pct = (n / b.total) * 100;
    stops.push(`${colour} ${cursor.toFixed(2)}%`);
    cursor += pct;
    stops.push(`${colour} ${cursor.toFixed(2)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export function ZerouHeatStrip({ events, onJumpToFile }: ZerouHeatStripProps) {
  const squares = useMemo(() => groupByFile(events), [events]);
  const [hovered, setHovered] = useState<string | null>(null);

  if (squares.length === 0) {
    return (
      <div
        data-testid="zerou-heat-strip"
        className="bg-paper border border-warmline rounded-lg px-4 py-3 text-xs text-muted italic"
      >
        no data
      </div>
    );
  }

  const totalFiles = squares.length;
  const totalCovered = squares.reduce((s, sq) => s + sq.breakdown.covered, 0);
  const totalBranches = squares.reduce((s, sq) => s + sq.breakdown.total, 0);

  // Pick the first + middle + last "group anchor" labels for the strip
  // footer. We don't try to fit every file name underneath; a screenful
  // of 30+ would just turn into garbage. Three anchors give shape.
  const anchorIdxs = totalFiles <= 3
    ? squares.map((_, i) => i)
    : [0, Math.floor(totalFiles / 2), totalFiles - 1];

  return (
    <div
      data-testid="zerou-heat-strip"
      className="bg-paper border border-warmline rounded-lg overflow-hidden"
    >
      <div className="px-4 py-2 bg-cream border-b border-warmline flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-muted font-mono">
          Project heatmap · <span className="text-ink">{totalFiles}</span> files ·{' '}
          <span className="text-forest">{totalCovered}</span> /{' '}
          <span className="text-ink">{totalBranches}</span> covered
        </div>
        <div className="text-[10px] text-muted/70 font-sans italic">
          click a square to jump · hover for details
        </div>
      </div>

      <div className="px-4 py-3">
        <div
          role="list"
          aria-label="project file coverage heatmap"
          className="grid gap-[3px]"
          style={{ gridTemplateColumns: `repeat(${Math.min(totalFiles, 48)}, minmax(0, 1fr))` }}
          data-testid="zerou-heat-strip-grid"
        >
          {squares.map((sq) => {
            const grad = squareBackground(sq.breakdown);
            const solidClass = grad ? '' : STATE_BG[sq.breakdown.aggregate as Exclude<typeof sq.breakdown.aggregate, 'mixed'>];
            const overlay =
              sq.breakdown.aggregate === 'mechanical-red'
                ? STATE_OVERLAY['mechanical-red']
                : sq.breakdown.aggregate === 'business-red'
                ? STATE_OVERLAY['business-red']
                : undefined;

            const ariaLabel =
              `${sq.path} — ${sq.breakdown.covered} of ${sq.breakdown.total} covered, ` +
              `${sq.breakdown.businessRed + sq.breakdown.mechanicalRed} untested ` +
              `(state: ${sq.breakdown.aggregate === 'mixed' ? 'mixed' : STATE_LABEL[sq.breakdown.aggregate]})`;

            return (
              <button
                type="button"
                role="listitem"
                key={sq.path}
                onClick={() => onJumpToFile?.(sq.path)}
                onMouseEnter={() => setHovered(sq.path)}
                onMouseLeave={() =>
                  setHovered((prev) => (prev === sq.path ? null : prev))
                }
                onFocus={() => setHovered(sq.path)}
                onBlur={() =>
                  setHovered((prev) => (prev === sq.path ? null : prev))
                }
                data-testid={`zerou-heat-strip-square-${sq.path.replace(/[\\/.]/g, '-')}`}
                data-aggregate={sq.breakdown.aggregate}
                aria-label={ariaLabel}
                title={ariaLabel}
                className={`relative h-6 rounded-[2px] border border-warmline/60 ${
                  solidClass
                } ${sq.breakdown.aggregate === 'evaluating' ? 'anim-tick' : ''} ${
                  sq.breakdown.aggregate === 'retrying' ? 'anim-retry-pulse' : ''
                } hover:ring-2 hover:ring-coral/60 hover:z-10 focus:outline-none focus:ring-2 focus:ring-coral focus:z-10 transition-shadow`}
                style={grad ? { backgroundImage: grad } : undefined}
              >
                {overlay && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 flex items-center justify-center text-[10px] leading-none pointer-events-none"
                  >
                    {overlay}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tooltip ALWAYS rendered to avoid layout shift / flicker when
            hovering between squares. Visibility is opacity-driven. */}
        <div
          className={`mt-2 text-[10px] font-mono text-muted truncate min-h-[1.25rem] transition-opacity duration-75 ${
            hovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          data-testid="zerou-heat-strip-tooltip"
          aria-live="polite"
        >
          {(() => {
            if (!hovered) return <>&nbsp;</>;
            const sq = squares.find((s) => s.path === hovered);
            if (!sq) return null;
            const b = sq.breakdown;
            return (
                <>
                  <span className="text-ink">{sq.path}</span>
                  <span className="text-muted/40 mx-1">·</span>
                  <span className="text-forest">{b.covered}</span> /{' '}
                  <span className="text-ink">{b.total}</span> covered
                  {b.businessRed > 0 && (
                    <>
                      <span className="text-muted/40 mx-1">·</span>
                      <span className="text-rust">🔒 {b.businessRed} business</span>
                    </>
                  )}
                  {b.mechanicalRed > 0 && (
                    <>
                      <span className="text-muted/40 mx-1">·</span>
                      <span className="text-rust/80">🔧 {b.mechanicalRed} mechanical</span>
                    </>
                  )}
                  {b.retrying > 0 && (
                    <>
                      <span className="text-muted/40 mx-1">·</span>
                      <span className="text-coral">↻ {b.retrying} retrying</span>
                    </>
                  )}
                  {b.evaluating > 0 && (
                    <>
                      <span className="text-muted/40 mx-1">·</span>
                      <span className="text-coral">↻ {b.evaluating} evaluating</span>
                    </>
                  )}
                </>
              );
            })()}
          </div>

        <div className="mt-2 flex justify-between text-[10px] text-muted/70 font-mono">
          {anchorIdxs.map((idx) => {
            const sq = squares[idx];
            if (!sq) return null;
            return (
              <span key={`anchor-${idx}`} className="truncate max-w-[33%]">
                {sq.path.length > 28 ? `…${sq.path.slice(-27)}` : sq.path}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
