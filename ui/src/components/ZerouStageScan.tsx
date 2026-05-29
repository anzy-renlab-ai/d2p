import { useMemo } from 'react';
import type { ReviewBundle, StageStatus } from '../types-zerou.js';
import { ZerouStageCard } from './ZerouStageCard.js';

/**
 * Stage ① — Scan view.
 *
 * What ZeroU just did: walked the project AST, enumerated every function +
 * every branch (if/try/switch/ternary). This is the "denominator" — the
 * coverage % later is meaningful only because we know how many branches
 * exist.
 */

export interface ZerouStageScanProps {
  bundle: ReviewBundle;
  status?: StageStatus;
}

export function ZerouStageScan({ bundle, status }: ZerouStageScanProps) {
  const branch = bundle.branchCoverage;
  const fnCount = branch?.summary.functionsAnalyzed ?? 0;
  const branchTotal = branch?.summary.branchesTotal ?? 0;
  const filesScanned = bundle.files.length;

  // Derive function-density buckets — how many functions live in each top
  // directory. Cheap visual proof of "the scanner saw your whole tree".
  const dirBuckets = useMemo(() => {
    if (!branch) return [];
    const m = new Map<string, number>();
    for (const fn of branch.functions) {
      const segs = fn.file.split(/[\\/]/);
      const top = segs.length > 1 ? `${segs[0]}/${segs[1] ?? ''}` : segs[0]!;
      m.set(top, (m.get(top) ?? 0) + 1);
    }
    return Array.from(m.entries())
      .sort((a, b) => b[1]! - a[1]!)
      .slice(0, 8);
  }, [branch]);

  const stageStatus: StageStatus =
    status ?? (branch && branch.availability.ast ? 'done' : 'fail');

  const metric = (
    <>
      <span className="text-ink">{fnCount}</span> fns ·{' '}
      <span className="text-electric font-semibold">{branchTotal}</span> branches
    </>
  );

  return (
    <ZerouStageCard
      numeral="①"
      title="扫"
      metric={metric}
      subMetric={
        branch
          ? `AST 静态分析 · ${branch.availability.spec ? 'specs ✓' : 'specs —'} · ${branch.availability.judge ? 'judge ✓' : 'judge —'}`
          : 'no coverage report'
      }
      status={stageStatus}
      testId="zerou-stage-scan"
    >
      <div className="px-5 py-4 space-y-3 text-sm">
        <div className="text-xs text-muted font-mono leading-relaxed">
          ZeroU 用 ts-morph 走了项目的 AST，枚举每个 function 里的每条分支（if /
          try / switch / ternary / loop）。这条 stage 没漏掉任何节点 — 否则下面
          coverage % 就站不住脚。
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
          <Metric label="FILES SCANNED" value={filesScanned.toString()} />
          <Metric label="FUNCTIONS" value={fnCount.toString()} />
          <Metric label="BRANCHES" value={branchTotal.toString()} />
          <Metric
            label="WITH SPECS"
            value={`${branch?.functions.filter((f) => f.associatedSpecs.length > 0).length ?? 0}`}
          />
        </div>

        {dirBuckets.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted/70 mb-1.5">
              Function density by top-level dir
            </div>
            <ul
              className="space-y-1 font-mono text-xs"
              data-testid="zerou-stage-scan-dirs"
            >
              {dirBuckets.map(([dir, count]) => {
                const pct = fnCount > 0 ? (count / fnCount) * 100 : 0;
                return (
                  <li key={dir} className="flex items-center gap-2">
                    <span className="w-40 truncate text-ink" title={dir}>
                      {dir}/
                    </span>
                    <span className="flex-1 h-1.5 bg-paper rounded-full overflow-hidden border border-warmline/60">
                      <span
                        className="block h-full bg-coral/70"
                        style={{ width: `${Math.max(pct, 4)}%` }}
                      />
                    </span>
                    <span className="text-muted w-10 text-right">{count}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="text-[10px] text-muted/60 font-mono pt-1 border-t border-warmline/60">
          这是基线 — 后面 stage ⑤ 的覆盖率分母就是 {branchTotal} 这个数字。
        </div>
      </div>
    </ZerouStageCard>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-paper border border-warmline rounded-md px-3 py-2">
      <div className="text-[9px] uppercase tracking-widest text-muted/70 font-sans">
        {label}
      </div>
      <div className="text-base text-ink mt-0.5">{value}</div>
    </div>
  );
}
