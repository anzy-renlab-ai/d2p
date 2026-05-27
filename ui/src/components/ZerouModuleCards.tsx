import type { ReviewModule } from '../types-zerou.js';

const STATUS_GLYPH: Record<ReviewModule['status'], { glyph: string; tone: string; ring: string }> = {
  ok:      { glyph: '✓', tone: 'text-forest',  ring: 'ring-forest/30' },
  partial: { glyph: '◐', tone: 'text-coral',   ring: 'ring-coral/30' },
  skipped: { glyph: '—', tone: 'text-muted',   ring: 'ring-warmline' },
  failed:  { glyph: '✗', tone: 'text-rust',    ring: 'ring-rust/30' },
};

const STATUS_LABEL: Record<ReviewModule['status'], string> = {
  ok: 'ok',
  partial: 'partial',
  skipped: 'skipped',
  failed: 'failed',
};

export function ZerouModuleCards({ modules }: { modules: ReviewModule[] }) {
  return (
    <section data-testid="zerou-module-cards">
      <div className="text-[10px] uppercase tracking-widest text-muted/70 font-medium mb-2 px-1">
        Modules
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {modules.map((m) => {
          const meta = STATUS_GLYPH[m.status];
          return (
            <div
              key={m.id}
              className={`bg-cream border border-warmline rounded-lg p-4 ring-1 ${meta.ring}`}
              data-testid={`zerou-module-card-${m.id}`}
            >
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-xs font-mono uppercase tracking-wider text-ink">{m.id}</span>
                <span className={`text-lg leading-none ${meta.tone}`} aria-label={STATUS_LABEL[m.status]}>
                  {meta.glyph}
                </span>
              </div>
              <div className="text-sm text-ink font-medium leading-tight">{m.label}</div>
              <div className="text-[11px] text-muted mt-1.5 leading-snug line-clamp-2 min-h-[2.5em]">
                {m.summary}
              </div>
              <div className="text-[10px] text-muted/60 font-mono mt-2">
                {m.filesTouched > 0 ? `${m.filesTouched} file${m.filesTouched === 1 ? '' : 's'}` : '—'}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
