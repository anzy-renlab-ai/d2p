import type { ReviewBundle } from '../types-zerou.js';

/** Top hero strip — 6 stat columns. Mirrors d2p Done.tsx hero + Workspace
 *  StatusStrip rhythm: big mono number, small uppercase muted label.
 */
export function ZerouHeroBar({ bundle }: { bundle: ReviewBundle }) {
  const additions = bundle.files.reduce((s, f) => s + f.additions, 0);
  const deletions = bundle.files.reduce((s, f) => s + f.deletions, 0);
  const findingsPatched = bundle.findings.filter((f) => f.status === 'patched').length;
  const branch = bundle.branchCoverage;
  const coveredPct = branch && branch.summary.branchesTotal > 0
    ? Math.round((branch.summary.branchesCovered / branch.summary.branchesTotal) * 100)
    : 0;
  const selfDeceiving = branch?.summary.selfDeceivingTotal ?? 0;

  return (
    <section
      className="bg-cream border border-warmline rounded-lg px-6 py-5"
      data-testid="zerou-hero-bar"
    >
      <div className="flex items-baseline justify-between mb-4 gap-4 flex-wrap">
        <div>
          <div className="text-[10px] font-mono text-coral uppercase tracking-widest mb-1">
            ZeroU review
          </div>
          <h1 className="text-2xl tracking-tight">{bundle.project.name}</h1>
          <div className="text-xs text-muted mt-1 font-mono break-all">
            {bundle.project.cwd}
          </div>
          <div className="text-xs text-muted/80 mt-0.5 font-mono break-all">
            branch · {bundle.project.branch}
          </div>
        </div>
        <div className="text-right text-[10px] text-muted/70 font-mono">
          run · {bundle.project.runTs}
          <br />
          {new Date(bundle.generatedAt).toLocaleString()}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
        <Stat label="DURATION" value={formatDuration(bundle.durationMs)} />
        <Stat label="FILES" value={bundle.files.length.toString()} />
        <Stat
          label="DELTA"
          value={
            <span>
              <span className="text-forest">+{additions}</span>
              <span className="text-muted mx-1">·</span>
              <span className="text-rust">-{deletions}</span>
            </span>
          }
        />
        <Stat
          label="FINDINGS"
          value={`${bundle.findings.length}`}
          sub={`${findingsPatched} patched`}
          tone={findingsPatched === 0 ? 'warn' : 'ok'}
        />
        <Stat
          label="COVERED"
          value={`${coveredPct}%`}
          sub={branch ? `${branch.summary.functionsAnalyzed} fns` : 'n/a'}
          tone={coveredPct < 50 ? 'warn' : 'ok'}
        />
        <Stat
          label="RISKS"
          value={`${selfDeceiving}`}
          sub="self-deceiving"
          tone={selfDeceiving > 0 ? 'warn' : 'ok'}
        />
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | React.ReactNode;
  sub?: string;
  tone?: 'ok' | 'warn';
}) {
  const color = tone === 'warn' ? 'text-coral' : 'text-ink';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted/70 font-medium font-sans">
        {label}
      </div>
      <div className={`text-2xl font-mono ${color} mt-1 leading-tight`}>{value}</div>
      {sub && <div className="text-[10px] text-muted/60 font-mono mt-0.5">{sub}</div>}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem.toString().padStart(2, '0')}s`;
}
