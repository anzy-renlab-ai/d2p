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

const DEFAULT_TOP_N = 8;

export function ZerouHeatStrip({ events, onJumpToFile }: ZerouHeatStripProps) {
  const squares = useMemo(() => groupByFile(events), [events]);
  const [showAll, setShowAll] = useState(false);

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
  const totalBusiness = squares.reduce((s, sq) => s + sq.breakdown.businessRed, 0);
  const totalMechanical = squares.reduce((s, sq) => s + sq.breakdown.mechanicalRed, 0);
  const totalEvaluating = squares.reduce((s, sq) => s + sq.breakdown.evaluating, 0);
  const totalRetrying = squares.reduce((s, sq) => s + sq.breakdown.retrying, 0);

  // Squares are already sorted by attention rank (business-red first).
  const visible = showAll ? squares : squares.slice(0, DEFAULT_TOP_N);
  const hidden = squares.length - visible.length;

  // Tiny project-level overview bar at the top (one segment per state class).
  const overviewSegments: Array<{ key: string; w: number; cls: string; label: string }> = [];
  const pushSeg = (key: string, n: number, cls: string, label: string) => {
    if (n <= 0) return;
    overviewSegments.push({ key, w: (n / totalBranches) * 100, cls, label });
  };
  pushSeg('covered', totalCovered, 'bg-forest', 'covered');
  pushSeg('evaluating', totalEvaluating, 'bg-coral', 'evaluating');
  pushSeg('retrying', totalRetrying, 'bg-coral/60', 'retrying');
  pushSeg('mechanical', totalMechanical, 'bg-rust/70', 'mechanical');
  pushSeg('business', totalBusiness, 'bg-rust', 'business');

  return (
    <div
      data-testid="zerou-heat-strip"
      className="bg-paper border border-warmline rounded-lg overflow-hidden"
    >
      <div className="px-4 py-2 bg-cream border-b border-warmline flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-muted font-mono">
          Project · <span className="text-ink">{totalFiles}</span> files ·{' '}
          <span className="text-forest">{totalCovered}</span> /{' '}
          <span className="text-ink">{totalBranches}</span> covered
          {' '}({((totalCovered / totalBranches) * 100).toFixed(1)}%)
        </div>
        <div className="text-[10px] text-muted/70 font-sans italic">
          click a row to jump to that file
        </div>
      </div>

      {/* Project-level overview: a single thin bar segmented by state. */}
      <div className="px-4 pt-3">
        <div
          className="flex h-1.5 w-full overflow-hidden rounded-sm bg-muted/15"
          role="img"
          aria-label={`overall ${totalCovered}/${totalBranches} covered`}
          data-testid="zerou-heat-overview-bar"
        >
          {overviewSegments.map((s) => (
            <div
              key={s.key}
              className={s.cls}
              style={{ width: `${s.w}%` }}
              title={`${s.label}: ${Math.round(s.w * 10) / 10}%`}
            />
          ))}
        </div>
        <div className="mt-2 flex gap-3 text-[10px] text-muted font-mono flex-wrap">
          <span><span className="inline-block w-2 h-2 bg-forest rounded-sm mr-1" />covered {totalCovered}</span>
          {totalEvaluating > 0 && <span><span className="inline-block w-2 h-2 bg-coral rounded-sm mr-1" />evaluating {totalEvaluating}</span>}
          {totalRetrying > 0 && <span><span className="inline-block w-2 h-2 bg-coral/60 rounded-sm mr-1" />retrying {totalRetrying}</span>}
          {totalMechanical > 0 && <span><span className="inline-block w-2 h-2 bg-rust/70 rounded-sm mr-1" />🔧 mechanical {totalMechanical}</span>}
          {totalBusiness > 0 && <span><span className="inline-block w-2 h-2 bg-rust rounded-sm mr-1" />🔒 business {totalBusiness}</span>}
        </div>
      </div>

      {/* Ranked attention list — one row per file, sorted by red density. */}
      <div className="px-4 py-3">
        <div className="text-[10px] uppercase tracking-widest text-muted/70 font-mono mb-2">
          most attention needed
        </div>
        <ul role="list" className="space-y-1" data-testid="zerou-heat-list">
          {visible.map((sq) => {
            const b = sq.breakdown;
            const redTotal = b.businessRed + b.mechanicalRed;
            const inProgress = b.evaluating + b.retrying;
            const glyph =
              redTotal === 0 && inProgress === 0
                ? '✓'
                : b.businessRed > 0
                ? STATE_OVERLAY['business-red']
                : b.mechanicalRed > 0
                ? STATE_OVERLAY['mechanical-red']
                : '↻';
            const glyphCls =
              redTotal === 0 && inProgress === 0
                ? 'text-forest'
                : b.businessRed > 0
                ? 'text-rust'
                : b.mechanicalRed > 0
                ? 'text-rust/80'
                : 'text-coral';
            const animCls =
              b.retrying > 0 ? 'anim-retry-pulse' : b.evaluating > 0 ? 'anim-spin-arrow' : '';

            return (
              <li key={sq.path}>
                <button
                  type="button"
                  onClick={() => onJumpToFile?.(sq.path)}
                  data-testid={`zerou-heat-row-${sq.path.replace(/[\\/.]/g, '-')}`}
                  data-aggregate={b.aggregate}
                  className="w-full flex items-center gap-3 px-2 py-1.5 rounded-sm hover:bg-cream focus:outline-none focus:ring-1 focus:ring-coral text-left transition-colors"
                >
                  <span className={`text-base inline-block w-5 text-center ${glyphCls} ${animCls}`} aria-hidden="true">
                    {glyph}
                  </span>
                  <span className="font-mono text-xs text-ink truncate flex-1 min-w-0">
                    {sq.path}
                  </span>
                  <span className="font-mono text-[10px] text-muted shrink-0 tabular-nums">
                    {redTotal > 0 && (
                      <>
                        <span className="text-rust">{redTotal}</span>
                        <span className="text-muted/40"> red</span>
                      </>
                    )}
                    {redTotal > 0 && (b.covered > 0 || inProgress > 0) && <span className="mx-1.5 text-muted/40">·</span>}
                    {b.covered > 0 && (
                      <>
                        <span className="text-forest">{b.covered}</span>
                        <span className="text-muted/40"> ok</span>
                      </>
                    )}
                    {inProgress > 0 && (
                      <>
                        {b.covered > 0 && <span className="mx-1.5 text-muted/40">·</span>}
                        <span className="text-coral">{inProgress}</span>
                        <span className="text-muted/40"> {b.retrying > 0 ? 'retrying' : 'evaluating'}</span>
                      </>
                    )}
                  </span>
                  <span className="text-[10px] text-muted/50 font-mono shrink-0 group-hover:text-coral">→</span>
                </button>
              </li>
            );
          })}
        </ul>

        {hidden > 0 && !showAll && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mt-3 text-[10px] text-muted hover:text-coral underline font-mono"
            data-testid="zerou-heat-show-all"
          >
            show all {totalFiles} files ({hidden} more)
          </button>
        )}
        {showAll && totalFiles > DEFAULT_TOP_N && (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="mt-3 text-[10px] text-muted hover:text-coral underline font-mono"
          >
            collapse to top {DEFAULT_TOP_N}
          </button>
        )}
      </div>
    </div>
  );
}
