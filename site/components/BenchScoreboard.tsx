import { Pill } from './Pill';

type Row = {
  bench: string;
  truths: string;
  zerou: string;
  sonnet: string;
  opus: string;
  winner: 'ZeroU' | 'Opus' | 'tie' | 'both-lose';
  note: string;
};

// Numbers come directly from D:/lll/hardener-bench/COMPARISON.md (Phase 22).
// We quote them verbatim with the alpha / n=1 disclaimer.
const rows: Row[] = [
  {
    bench: 'zerou-target',
    truths: '19',
    zerou: 'P=0.91 · R=1.00',
    sonnet: 'P=0.46 · R=0.90',
    opus: 'P=0.41 · R=0.95',
    winner: 'ZeroU',
    note: 'Preset-aligned vulns: secrets / SQLi / missing-auth / weak-crypto. ZeroU is 2.2× more precise at equal recall.',
  },
  {
    bench: 'juice-shop-mini',
    truths: '20',
    zerou: 'R=0.75',
    sonnet: 'R=0.00',
    opus: '(too slow to finish in cap)',
    winner: 'ZeroU',
    note: 'OWASP Juice Shop (681 files). Sonnet&apos;s fair 200-file cap missed every truth file. ZeroU scans the whole repo for ~$0.20.',
  },
  {
    bench: 'bugsjs-mini',
    truths: '50',
    zerou: '0 / 50',
    sonnet: '6 / 50',
    opus: '11 / 50',
    winner: 'Opus',
    note: 'Pure logic bugs (off-by-one, missing await). Honest loss: no preset covers this class yet — roadmap item.',
  },
  {
    bench: 'cost / audit',
    truths: '—',
    zerou: '$0.05 – $0.20',
    sonnet: '$0.50 – $1.50',
    opus: '$2.00 – $8.00',
    winner: 'ZeroU',
    note: 'ZeroU&apos;s cost scales with finding count (MiniMax critic). Raw Claude scales with codebase size.',
  },
];

function winnerPill(w: Row['winner']) {
  if (w === 'ZeroU') return <Pill tone="coral">ZeroU</Pill>;
  if (w === 'Opus') return <Pill tone="amber">Opus</Pill>;
  if (w === 'both-lose') return <Pill tone="rust">both lose</Pill>;
  return <Pill tone="slate">tie</Pill>;
}

export function BenchScoreboard() {
  return (
    <section id="bench" className="max-w-6xl mx-auto px-6 py-16">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted mb-2 font-mono">
            head-to-head
          </div>
          <h2 className="text-3xl tracking-tight leading-tight title-underline">
            Bench numbers, no spin.
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone="rust" mono>alpha</Pill>
          <Pill mono>n=1 measurement</Pill>
          <Pill mono>2026-05-28</Pill>
        </div>
      </div>

      <p className="text-sm text-muted max-w-3xl mb-8 leading-relaxed">
        Phase 22 run of hardener-bench. ZeroU (MiniMax critic) vs raw Claude
        Sonnet 4.6 / Opus 4.7 via the CC subscription. Proximity scoring (file
        + line ± tolerance), uniform across tools. Methodology and reproducer
        in the{' '}
        <a
          href="https://github.com/Upp-Ljl/d2p/blob/main/docs/reviews/2026-05-28-public-benchmarks-survey.md"
          className="text-coral hover:underline"
        >
          comparison report
        </a>
        .
      </p>

      {/* Stat strip — Mission Control style big numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <Stat n="2.2×" label="precision vs Opus" sub="on zerou-target" />
        <Stat n="0.75" label="recall vs Sonnet 0" sub="on juice-shop" />
        <Stat n="~$0.20" label="cost per audit" sub="vs $2–$8 (Opus)" />
        <Stat n="0 / 50" label="bugsjs (honest gap)" sub="no logic-bug presets" />
      </div>

      {/* Comparison table */}
      <div className="card card-hover overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-coralsoft/20 text-[11px] uppercase tracking-widest text-muted">
                <th className="text-left px-4 py-3 font-mono font-medium">bench</th>
                <th className="text-left px-3 py-3 font-mono font-medium">truths</th>
                <th className="text-left px-3 py-3 font-mono font-medium">ZeroU</th>
                <th className="text-left px-3 py-3 font-mono font-medium">Sonnet 4.6</th>
                <th className="text-left px-3 py-3 font-mono font-medium">Opus 4.7</th>
                <th className="text-left px-3 py-3 font-mono font-medium">winner</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.bench}
                  className={[
                    'border-t border-warmline align-top',
                    i % 2 === 0 ? '' : 'bg-paper/30',
                  ].join(' ')}
                >
                  <td className="px-4 py-4">
                    <div className="font-mono text-[13px] text-ink font-medium">
                      {r.bench}
                    </div>
                    <div className="text-[11px] text-muted mt-1 max-w-md leading-relaxed">
                      <span dangerouslySetInnerHTML={{ __html: r.note }} />
                    </div>
                  </td>
                  <td className="px-3 py-4 font-mono text-[12px] text-muted">{r.truths}</td>
                  <td className="px-3 py-4 font-mono text-[12px] text-coral">{r.zerou}</td>
                  <td className="px-3 py-4 font-mono text-[12px] text-ink/80">{r.sonnet}</td>
                  <td className="px-3 py-4 font-mono text-[12px] text-ink/80">{r.opus}</td>
                  <td className="px-3 py-4">{winnerPill(r.winner)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 text-[11px] text-muted leading-relaxed max-w-3xl">
        <strong className="text-ink">What this isn&apos;t:</strong> peer-reviewed,
        multi-seed, statistically significant. n=1 per cell. ZeroU wins where
        presets cover the bug class; loses where they don&apos;t. The bench is
        our scoreboard, not a marketing slide.
      </div>
    </section>
  );
}

function Stat({ n, label, sub }: { n: string; label: string; sub: string }) {
  return (
    <div className="card p-4">
      <div className="font-mono text-2xl sm:text-3xl text-coral leading-none mb-2">
        {n}
      </div>
      <div className="text-[10px] uppercase tracking-widest text-ink/80 font-mono">
        {label}
      </div>
      <div className="text-[10px] text-muted mt-1">{sub}</div>
    </div>
  );
}
