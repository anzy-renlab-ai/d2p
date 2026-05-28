import { useMemo, useState } from 'react';
import type { ReviewBundle, StageStatus, BranchTraceEvent } from '../types-zerou.js';
import { ZerouStageCard } from './ZerouStageCard.js';
import { ZerouBranchTreeLog } from './ZerouBranchTreeLog.js';
import { ZerouHeatStrip } from './ZerouHeatStrip.js';

/**
 * Stage ⑤ — Trace view (the centerpiece).
 *
 * What ZeroU just did: emitted .zerou/branch-trace.jsonl — one event per
 * branch leaf, with verdict + spec evidence + hash chain. This stage is
 * the proof — every covered branch on the tree corresponds to a line in
 * the jsonl; uncovered branches show up untested.
 *
 * The tree-on-left + stream-on-right view lets the user audit it
 * directly: click a leaf, see the event; click a directory, filter to
 * its subtree.
 */

export interface ZerouStageTraceProps {
  bundle: ReviewBundle;
  /** Streamed live events from worker C's hook. Combined with the bundle's
   *  static events into a single timeline. */
  liveEvents?: BranchTraceEvent[];
  /** Connection state for the live badge. */
  liveConnected?: boolean;
  status?: StageStatus;
}

export function ZerouStageTrace({
  bundle,
  liveEvents,
  liveConnected,
  status,
}: ZerouStageTraceProps) {
  const staticEvents = bundle.branchTraceEvents ?? [];
  const allEvents = useMemo(() => {
    if (!liveEvents || liveEvents.length === 0) return staticEvents;
    // Merge by seq — live events are append-only past the static count.
    return [...staticEvents, ...liveEvents];
  }, [staticEvents, liveEvents]);

  // Heat-strip → tree jump token. Bumped each click so the tree useEffect
  // re-fires even if the user clicks the same square twice.
  const [jumpToken, setJumpToken] = useState<{ path: string; token: number } | null>(null);

  const total = allEvents.length;
  const branch = bundle.branchCoverage;

  const verdictCounts = useMemo(() => {
    const m = new Map<BranchTraceEvent['verdict'], number>();
    for (const ev of allEvents) m.set(ev.verdict, (m.get(ev.verdict) ?? 0) + 1);
    return m;
  }, [allEvents]);

  const coveredCount =
    (verdictCounts.get('covered') ?? 0) + (verdictCounts.get('run-only') ?? 0);
  const untestedCount = verdictCounts.get('untested') ?? 0;
  const denominator = branch?.summary.branchesTotal ?? total;
  const coveragePct = denominator > 0 ? (coveredCount / denominator) * 100 : 0;

  const stageStatus: StageStatus =
    status ?? (total > 0 ? 'done' : 'pending');

  const metric = (
    <>
      <span className="text-ink">{coveredCount}</span> /{' '}
      <span className="text-ink">{denominator}</span>{' '}
      <span className="text-coral">({coveragePct.toFixed(1)}%)</span> · log = proof
    </>
  );

  return (
    <ZerouStageCard
      numeral="⑤"
      title="追溯"
      metric={metric}
      subMetric={
        <>
          <span className="text-rust">{untestedCount} untested</span>
          <span className="text-muted/40 mx-2">·</span>
          <span className="font-mono">.zerou/branch-trace.jsonl · {total} events</span>
        </>
      }
      status={stageStatus}
      defaultOpen={true}
      testId="zerou-stage-trace"
    >
      <div className="px-4 py-4 space-y-3">
        <div className="text-xs text-muted font-mono leading-relaxed px-1">
          每片叶子对应 jsonl 里的一条 branch.evidence 事件。点叶子 → 看完整 event JSON
          + hash 链。点目录 / 文件 / 函数 → 把右边 log 流 filter 到该子树。任何带
          <span className="text-rust mx-1">🔴</span>的叶子是没被任何 spec / judge / run
          证明的分支 — 那就是 ZeroU 让你看见的"自我欺骗盲区"。
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px] font-mono">
          <Stat label="EVENTS" value={total.toString()} tone="text-ink" />
          <Stat label="COVERED" value={coveredCount.toString()} tone="text-forest" />
          <Stat label="JUDGE-ONLY" value={`${verdictCounts.get('judge-only') ?? 0}`} tone="text-coral" />
          <Stat label="SPEC-ONLY" value={`${verdictCounts.get('spec-only') ?? 0}`} tone="text-coral" />
          <Stat label="UNTESTED" value={untestedCount.toString()} tone="text-rust" />
        </div>

        <ZerouHeatStrip
          events={allEvents}
          onJumpToFile={(path) => setJumpToken({ path, token: Date.now() })}
        />

        <ZerouBranchTreeLog
          events={allEvents}
          liveConnected={liveConnected}
          staticEventCount={staticEvents.length}
          scrollToFile={jumpToken}
        />

        <div className="text-[10px] text-muted/70 font-serif italic pt-1 border-t border-warmline/60">
          jq + sort + wc 可复算: cat .zerou/branch-trace.jsonl | jq -r '.branch_id' |
          sort -u | wc -l == {denominator}
        </div>
      </div>
    </ZerouStageCard>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="bg-paper border border-warmline rounded-md px-3 py-2">
      <div className="text-[9px] uppercase tracking-widest text-muted/70 font-sans">
        {label}
      </div>
      <div className={`text-base mt-0.5 ${tone}`}>{value}</div>
    </div>
  );
}
