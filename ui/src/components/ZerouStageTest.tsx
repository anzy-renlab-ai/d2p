import { useMemo } from 'react';
import type { ReviewBundle, StageStatus } from '../types-zerou.js';
import { ZerouStageCard } from './ZerouStageCard.js';

/**
 * Stage ② — Test view.
 *
 * What ZeroU just did: red-team generator produced adversarial specs for
 * each function; an LLM judge graded user's existing tests against them.
 * Output: per-branch verdict ∈ {covered, judge-only, spec-only, untested}.
 */

export interface ZerouStageTestProps {
  bundle: ReviewBundle;
  status?: StageStatus;
}

export function ZerouStageTest({ bundle, status }: ZerouStageTestProps) {
  const audit = bundle.audit;
  const branch = bundle.branchCoverage;

  const verdictCounts = useMemo(() => {
    if (!bundle.branchTraceEvents) return null;
    const m = new Map<string, number>();
    for (const ev of bundle.branchTraceEvents) {
      m.set(ev.verdict, (m.get(ev.verdict) ?? 0) + 1);
    }
    return m;
  }, [bundle.branchTraceEvents]);

  const specCount = branch
    ? branch.functions.reduce((s, f) => s + f.associatedSpecs.length, 0)
    : 0;

  const stageStatus: StageStatus =
    status ??
    (audit && audit.testCases.fail === 0
      ? 'done'
      : audit && audit.testCases.fail > 0
      ? 'done' // still done — fails are expected adversarial signal, not crash
      : 'pending');

  const total = audit?.testCases.total ?? 0;
  const metric = (
    <>
      <span className="text-ink">{total}</span> specs ·{' '}
      <span className="text-ink">{specCount}</span> matched · LLM-judge
    </>
  );

  return (
    <ZerouStageCard
      numeral="②"
      title="测"
      metric={metric}
      subMetric={
        audit ? (
          <>
            <span className="text-forest">{audit.testCases.pass} pass</span>
            <span className="text-muted/40 mx-2">·</span>
            <span className="text-rust">{audit.testCases.fail} fail</span>
            {audit.testCases.inconclusive > 0 && (
              <>
                <span className="text-muted/40 mx-2">·</span>
                <span className="text-coral">{audit.testCases.inconclusive} inconclusive</span>
              </>
            )}
            {audit.testCases.skipped > 0 && (
              <>
                <span className="text-muted/40 mx-2">·</span>
                <span className="text-muted">{audit.testCases.skipped} skipped</span>
              </>
            )}
          </>
        ) : (
          'no audit run'
        )
      }
      status={stageStatus}
      testId="zerou-stage-test"
    >
      <div className="px-5 py-4 space-y-3 text-sm">
        <div className="text-xs text-muted font-mono leading-relaxed">
          红队 generator 给每个 function 出 adversarial specs，judge 用 LLM 把它们
          和你既有的 test suite 对齐。每条分支拿到一个 verdict — 这是 stage ⑤ 树
          上叶子状态的来源。
        </div>

        {verdictCounts && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted/70 mb-1.5">
              Per-branch verdict distribution
            </div>
            <ul
              className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-xs"
              data-testid="zerou-stage-test-verdicts"
            >
              <VerdictRow label="covered" count={verdictCounts.get('covered') ?? 0} tone="text-forest" glyph="✓" />
              <VerdictRow label="run-only" count={verdictCounts.get('run-only') ?? 0} tone="text-forest" glyph="🟢" />
              <VerdictRow label="judge-only" count={verdictCounts.get('judge-only') ?? 0} tone="text-coral" glyph="🟡" />
              <VerdictRow label="spec-only" count={verdictCounts.get('spec-only') ?? 0} tone="text-coral" glyph="⚠" />
              <VerdictRow label="untested" count={verdictCounts.get('untested') ?? 0} tone="text-rust" glyph="🔴" />
              <VerdictRow label="unknown" count={verdictCounts.get('unknown') ?? 0} tone="text-muted" glyph="•" />
            </ul>
          </div>
        )}

        {audit && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
            <Box label="JUDGE DURATION" value={`${(audit.durationMs / 1000).toFixed(1)}s`} />
            <Box label="HARDENING FINDINGS" value={audit.hardeningFindings.toString()} />
            <Box label="TEST CASES" value={audit.testCases.total.toString()} />
            <Box
              label="PASS RATE"
              value={
                audit.testCases.total > 0
                  ? `${Math.round((audit.testCases.pass / audit.testCases.total) * 100)}%`
                  : '—'
              }
            />
          </div>
        )}

        <div className="text-[10px] text-muted/60 font-serif italic pt-1 border-t border-warmline/60">
          fail ≠ 坏事 — 红队故意挑出你没覆盖的分支，是 stage ③ 的修复输入。
        </div>
      </div>
    </ZerouStageCard>
  );
}

function VerdictRow({
  label,
  count,
  tone,
  glyph,
}: {
  label: string;
  count: number;
  tone: string;
  glyph: string;
}) {
  return (
    <li
      className="bg-paper border border-warmline rounded px-2.5 py-1.5 flex items-center justify-between"
      data-testid={`zerou-stage-test-verdict-${label}`}
    >
      <span className="flex items-center gap-1.5">
        <span className={tone}>{glyph}</span>
        <span className="text-ink">{label}</span>
      </span>
      <span className={`${tone} font-medium`}>{count}</span>
    </li>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-paper border border-warmline rounded-md px-3 py-2">
      <div className="text-[9px] uppercase tracking-widest text-muted/70 font-sans">
        {label}
      </div>
      <div className="text-base text-ink mt-0.5">{value}</div>
    </div>
  );
}
