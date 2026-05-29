import { Pill } from './Pill';

/**
 * Real before/after numbers from a meme-weather audit + enhance run.
 *
 * Sources (verbatim — do not round / inflate):
 *   D:/lll/meme-weather-zerou-test/.zerou/audit-report.md
 *   D:/lll/meme-weather-zerou-test/.zerou/enhance-report.md
 */

type Row = { label: string; tone?: 'good' | 'gap' };

const beforeRows: Row[] = [
  { label: 'No structured logger (console.log scattered)', tone: 'gap' },
  { label: 'No /health endpoint', tone: 'gap' },
  { label: 'No Sentry SDK wired', tone: 'gap' },
  { label: 'No middleware / trace_id propagation', tone: 'gap' },
  { label: 'No .env.example entry for LOG_LEVEL', tone: 'gap' },
  { label: '31 hardening gaps unreviewed (1 P1 · 18 P2 · 12 P3)', tone: 'gap' },
  { label: '0 auto-generated route tests', tone: 'gap' },
  { label: 'No audit trail — nothing to grep six months later', tone: 'gap' },
];

const afterRows: Row[] = [
  { label: 'pino logger bootstrap — src/logger.ts (+61 LOC, AsyncLocalStorage correlation, redact rules)', tone: 'good' },
  { label: '/health endpoint — app/health/route.ts (+14 LOC)', tone: 'good' },
  { label: 'Sentry SDK — @sentry/nextjs@^8.50.0 + 3 configs + instrumentation.ts', tone: 'good' },
  { label: 'middleware.ts (+30 LOC) — x-correlation-id in/out, request.start / request.end events', tone: 'good' },
  { label: '.env.example — LOG_LEVEL added (7 vars already declared, untouched)', tone: 'good' },
  { label: '119 console.log → logger sites planned across 5 files (33 already migrated in lib/db/*)', tone: 'good' },
  { label: '13 generated test specs — one per API route under tests/__zerou__/', tone: 'good' },
  { label: 'Decision-event JSONL log under .zerou/logs/ — replayable audit trail', tone: 'good' },
];

const statStrip = [
  { n: '31', label: 'findings', sub: 'across 25 categories' },
  { n: '119', label: 'logger sites', sub: 'planned · 5 files' },
  { n: '13', label: 'test specs', sub: 'one per route' },
  { n: '1m 30s', label: 'wall clock', sub: 'enhance, end-to-end' },
  { n: 'PASS', label: 'verify gate', sub: 'install · tsc · test' },
];

export function MemeWeatherShowcase() {
  return (
    <section id="meme-weather" className="max-w-6xl mx-auto px-6 py-16">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted mb-2 font-mono">
            real demo · real diff · real numbers
          </div>
          <h2 className="text-3xl tracking-tight leading-tight">
            We ran ZeroU against a vibe-coded Next.js app.
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
        meme-weather is a real meme-prediction app — Next.js 15, Drizzle ORM,
        Supabase, Tailwind, vibe-coded over a weekend. We ran{' '}
        <code className="font-mono text-coral">zerou audit</code> (7s) then{' '}
        <code className="font-mono text-coral">zerou enhance</code> (1m 30s),
        end-to-end auto, on its own worktree. Numbers below are pulled verbatim
        from the report files — no rounding.
      </p>

      {/* Stat strip — Mission Control style */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-10">
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

      {/* Two columns — Before / After */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Column
          kind="before"
          title="Before"
          subtitle="raw demo · meme-weather @ main"
          rows={beforeRows}
        />
        <Column
          kind="after"
          title="After 1m 30s"
          subtitle="zerou enhance · branch zerou-enhance-20260528-131520"
          rows={afterRows}
        />
      </div>

      {/* Honesty footer — P1 patches did not auto-merge */}
      <div className="mt-6 card p-5 border-l-2 border-l-coral">
        <div className="text-[11px] uppercase tracking-widest text-muted font-mono mb-2">
          honest line
        </div>
        <p className="text-sm text-ink/80 leading-relaxed">
          Of the 24 bug-fix candidates, the enhance pass{' '}
          <strong className="text-ink">auto-patched 0</strong> — 12 skipped
          (needs auth helper / row-predicate / tx rewrite) and 12 failed
          (no critic LLM wired in this run). That&apos;s the point: ZeroU surfaces
          P1 / P2 work on its own branch so a human reviews the diff before it
          touches main. Hardening that runs is logging, health, Sentry,
          middleware, tests — the mechanical scaffolding. Logic bugs go to the
          queue.
        </p>
      </div>

      <div className="mt-4 text-[11px] text-muted leading-relaxed max-w-3xl">
        Quoted from{' '}
        <code className="font-mono text-ink/80">.zerou/audit-report.md</code>
        {' '}and{' '}
        <code className="font-mono text-ink/80">.zerou/enhance-report.md</code>.
        Reproduce:{' '}
        <code className="font-mono text-coral">cd meme-weather-zerou-test &amp;&amp; npx zerou audit &amp;&amp; npx zerou enhance</code>.
      </div>
    </section>
  );
}

function Column({
  kind,
  title,
  subtitle,
  rows,
}: {
  kind: 'before' | 'after';
  title: string;
  subtitle: string;
  rows: Row[];
}) {
  const accent = kind === 'before' ? 'text-rust' : 'text-forest';
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-1">
        <div className={['font-serif text-2xl', accent].join(' ')}>{title}</div>
        <Pill tone={kind === 'before' ? 'rust' : 'forest'} mono>
          {kind}
        </Pill>
      </div>
      <div className="text-[11px] uppercase tracking-widest text-muted font-mono mb-4">
        {subtitle}
      </div>
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start gap-2.5 text-sm">
            <span
              aria-hidden
              className={[
                'font-mono text-[12px] leading-5 mt-px shrink-0 w-4',
                r.tone === 'gap' ? 'text-rust' : 'text-forest',
              ].join(' ')}
            >
              {r.tone === 'gap' ? '✗' : '✓'}
            </span>
            <span className="text-ink/85 leading-relaxed">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
