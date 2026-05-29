import HeroDemo from './HeroDemo';

/**
 * DemoShowcase — full-width section that hosts the under-a-minute HeroDemo
 * as the page's visual centerpiece (concern #5: don't tuck it in the corner).
 *
 * Alternating paper-cream background, max-w-6xl content column, generous
 * vertical padding so the demo card feels like the second page of the site.
 */
export function DemoShowcase() {
  return (
    <section id="demo" className="bg-paper border-y border-warmline/60">
      <div className="max-w-6xl mx-auto px-6 py-20 sm:py-24">
        <div className="text-center mb-10">
          <div className="text-xs font-mono text-coral uppercase tracking-widest mb-3">
            the under-a-minute tour
          </div>
          <h2 className="text-3xl sm:text-4xl font-serif tracking-tight mb-3">
            Under a minute, end-to-end.
          </h2>
          <p className="text-muted text-base sm:text-lg max-w-2xl mx-auto">
            From a vibe demo to a verified, traceable, hardened app — with bench
            receipts at the end.
          </p>
        </div>

        {/* Demo card — the centerpiece */}
        <div className="rounded-2xl border border-warmline bg-cream shadow-cardHover overflow-hidden">
          <div className="min-h-[680px] max-h-[760px] p-3 sm:p-4">
            <HeroDemo />
          </div>
        </div>

        {/* Phase legend */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] sm:text-xs font-mono text-muted">
          <LegendDot color="bg-rust" label="Problem" />
          <LegendDot color="bg-coral" label="Install" />
          <LegendDot color="bg-amber-600" label="Scan" />
          <LegendDot color="bg-forest" label="Test/Fix" />
          <LegendDot color="bg-plum-600" label="Enhance/Trace" />
          <LegendDot color="bg-sage-600" label="Verify" />
          <LegendDot color="bg-coral" label="Bench" />
        </div>
      </div>
    </section>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} />
      <span>{label}</span>
    </span>
  );
}
