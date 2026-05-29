import { Pill } from './Pill';

/**
 * Case study: what `zerou enhance` produced on a real Next.js demo.
 *
 * Sources (verbatim — do not round / inflate):
 *   D:/lll/meme-weather-zerou-test/.zerou/enhance-report.md
 */

type ChangedFile = {
  path: string;
  delta: string;
  status: 'new' | 'edit' | 'rewrite';
};

const changedFiles: ChangedFile[] = [
  { path: 'src/logger.ts', delta: '+61 LOC', status: 'new' },
  { path: 'middleware.ts', delta: '+30 LOC', status: 'new' },
  { path: 'instrumentation.ts', delta: '+8 LOC', status: 'new' },
  { path: 'sentry.{client,server,edge}.config.ts', delta: '+18 LOC', status: 'new' },
  { path: 'app/health/route.ts', delta: '+14 LOC', status: 'new' },
  { path: '.env.example', delta: '+3 LOC', status: 'edit' },
  { path: 'lib/db/client.ts', delta: '+2 -1', status: 'edit' },
  { path: 'lib/db/seed.ts', delta: '+9 -8', status: 'edit' },
  { path: '119 console.log → logger.info', delta: '5 files', status: 'rewrite' },
];

const afterRows = [
  { label: 'pino logger bootstrap — src/logger.ts (AsyncLocalStorage correlation, redact rules)' },
  { label: '/health endpoint — app/health/route.ts' },
  { label: 'Sentry SDK — @sentry/nextjs@^8.50.0 + 3 configs + instrumentation.ts' },
  { label: 'middleware.ts — x-correlation-id in/out, request.start / request.end events' },
  { label: '.env.example — LOG_LEVEL added (7 vars already declared, untouched)' },
  { label: '119 console.log → logger sites across 5 files' },
  { label: 'Decision-event JSONL log under .zerou/logs/ — replayable audit trail' },
  { label: 'Verify gate PASS — install · tsc · test' },
];

const statStrip = [
  { n: '119', label: 'logger sites', sub: 'across 5 files' },
  { n: '9', label: 'new files', sub: 'observability stack' },
  { n: '1m 30s', label: 'wall clock', sub: 'enhance, end-to-end' },
  { n: 'PASS', label: 'verify gate', sub: 'install · tsc · test' },
];

export function MemeWeatherShowcase() {
  return (
    <section id="meme-weather" className="max-w-6xl mx-auto px-6 py-16">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted mb-2 font-mono">
            Case study · meme-weather (real Next.js demo on Vercel)
          </div>
          <h2 className="text-3xl tracking-tight leading-tight">
            What ZeroU produced on a real demo.
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone="forest" mono>meme-weather</Pill>
          <Pill mono>Next.js 15</Pill>
          <Pill mono>Drizzle + Supabase</Pill>
          <Pill mono>2026-05-28</Pill>
        </div>
      </div>

      <p className="text-sm text-muted max-w-3xl mb-8 leading-relaxed">
        We ran <code className="font-mono text-coral">zerou enhance</code> on
        meme-weather — a real Next.js + Drizzle + Supabase demo. Output below
        is the actual diff merged into the project.
      </p>

      {/* Stat strip — Mission Control style */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
        {statStrip.map((s) => (
          <div key={s.label} className="card p-4">
            <div className="font-mono text-2xl text-coral leading-none mb-2">
              {s.n}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-ink/80 font-mono">
              {s.label}
            </div>
            <div className="text-[10px] text-muted mt-1">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Two columns — What changed / What you get */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChangedFilesColumn rows={changedFiles} />
        <AfterColumn rows={afterRows} />
      </div>

      {/* Neutral footer — no auto-merge */}
      <div className="mt-6 card p-5 border-l-2 border-l-coral">
        <p className="text-sm text-ink/80 leading-relaxed">
          Branch{' '}
          <code className="font-mono text-coral">
            zerou-enhance-20260528-131520
          </code>
          {' '}— review the diff, merge or drop. ZeroU never auto-merges to
          your main.
        </p>
      </div>

      <div className="mt-4 text-[11px] text-muted leading-relaxed max-w-3xl">
        Quoted from{' '}
        <code className="font-mono text-ink/80">.zerou/enhance-report.md</code>.
        Reproduce:{' '}
        <code className="font-mono text-coral">cd meme-weather-zerou-test &amp;&amp; npx zerou enhance</code>.
      </div>
    </section>
  );
}

function ChangedFilesColumn({ rows }: { rows: ChangedFile[] }) {
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-1">
        <div className="font-serif text-2xl text-forest">What changed</div>
        <Pill tone="forest" mono>diff</Pill>
      </div>
      <div className="text-[11px] uppercase tracking-widest text-muted font-mono mb-4">
        9 new files · 3 edits · 1 mechanical rewrite
      </div>
      <ul className="space-y-2 anim-drift-in">
        {rows.map((r) => (
          <li
            key={r.path}
            className="flex items-baseline gap-2.5 text-[13px] font-mono"
          >
            <span
              aria-hidden
              className="text-forest text-[12px] leading-5 mt-px shrink-0 w-4"
            >
              ✓
            </span>
            <span className="text-ink/85 leading-relaxed flex-1 truncate">
              {r.path}
            </span>
            <span className="text-muted text-[11px] shrink-0">
              {r.delta}
              {r.status === 'new' ? '  (NEW)' : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AfterColumn({ rows }: { rows: { label: string }[] }) {
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-1">
        <div className="font-serif text-2xl text-forest">What you get</div>
        <Pill tone="forest" mono>after 1m 30s</Pill>
      </div>
      <div className="text-[11px] uppercase tracking-widest text-muted font-mono mb-4">
        production-grade observability stack
      </div>
      <ul className="space-y-2.5 anim-drift-in">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start gap-2.5 text-sm">
            <span
              aria-hidden
              className="font-mono text-[12px] leading-5 mt-px shrink-0 w-4 text-forest"
            >
              ✓
            </span>
            <span className="text-ink/85 leading-relaxed">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
