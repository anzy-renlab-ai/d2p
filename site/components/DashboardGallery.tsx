import { Pill } from './Pill';

type Shot = {
  src: string;
  caption: string;
  alt: string;
};

const shots: Shot[] = [
  {
    src: '/dashboards/01-home.png',
    alt: 'ZeroU projects list',
    caption: 'Projects list — pick a demo to operate on',
  },
  {
    src: '/dashboards/02-sessions.png',
    alt: 'ZeroU session board',
    caption: 'Session board — running, paused, done',
  },
  {
    src: '/dashboards/03-workspace.png',
    alt: 'ZeroU workspace view',
    caption: 'Workspace — agents working on fixes, commits with diff/rewind',
  },
  {
    src: '/dashboards/04-presets.png',
    alt: 'ZeroU preset library',
    caption: 'Preset library — 27 families, 359 rules, customizable',
  },
];

export function DashboardGallery() {
  return (
    <section
      id="dashboard"
      className="max-w-6xl mx-auto px-6 py-16"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted mb-2 font-mono">
            Dashboard · what running ZeroU looks like
          </div>
          <h2 className="text-3xl tracking-tight leading-tight title-underline">
            Watch every fix in flight
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone="forest" mono>localhost:5173</Pill>
          <Pill mono>local daemon</Pill>
        </div>
      </div>

      <p className="text-sm text-muted max-w-3xl mb-10 leading-relaxed">
        ZeroU runs as a local daemon with a web dashboard at{' '}
        <code className="font-mono text-coral">localhost:5173</code>. Mission
        Control over project → session → workspace → commit, with live fix
        progress.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {shots.map((s) => (
          <figure key={s.src} className="card-hover anim-drift-in">
            <img
              src={s.src}
              alt={s.alt}
              loading="lazy"
              className="w-full h-auto rounded-md border border-warmline shadow-sm"
            />
            <figcaption className="text-xs text-muted mt-2 font-mono">
              {s.caption}
            </figcaption>
          </figure>
        ))}
      </div>

    </section>
  );
}
