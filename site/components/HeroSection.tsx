import { Pill } from './Pill';

export function HeroSection() {
  return (
    <section className="relative overflow-hidden max-w-3xl mx-auto px-6 pt-20 pb-12 text-center">
      {/* Floating decorative blobs (Flourish 2) */}
      <div
        aria-hidden="true"
        className="float-1 absolute z-0 top-0 -right-16 w-[280px] h-[280px] rounded-full bg-coralsoft/20 filter blur-3xl pointer-events-none"
      />
      <div
        aria-hidden="true"
        className="float-2 absolute z-0 -bottom-12 -left-12 w-[200px] h-[200px] rounded-full bg-sage-100/30 filter blur-3xl pointer-events-none"
      />
      <div
        aria-hidden="true"
        className="float-3 absolute z-0 top-1/2 -right-8 w-[160px] h-[160px] rounded-full bg-amber-100/30 filter blur-3xl pointer-events-none"
      />

      <div className="relative z-10">
        <div className="text-xs font-mono text-coral uppercase tracking-widest mb-4">
          demo · to · production
        </div>
        <h1 className="text-5xl sm:text-6xl leading-[1.05] tracking-tight mb-5 font-serif">
          See what ZeroU did to your demo —{' '}
          <span className="text-coral">in 30 seconds.</span>
        </h1>
        <p className="text-lg text-muted max-w-2xl mx-auto leading-relaxed mb-8">
          ZeroU scans your vibe-coded demo, patches it, verifies the patch ran,
          and leaves a grep-able audit trail. Built for shipping, not for
          screenshots.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 mb-7">
          <a
            href="#quickstart"
            className="px-5 py-2.5 bg-coral text-cream rounded-md text-sm font-semibold hover:bg-coralhover transition-colors"
          >
            npm install zerou →
          </a>
          <a
            href="#bench"
            className="px-5 py-2.5 bg-cream text-ink rounded-md text-sm font-semibold border border-warmline hover:bg-coralsoft/30 transition-colors"
          >
            View benchmark
          </a>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 mb-12">
          <Pill mono tone="coral">scan</Pill>
          <Pill mono tone="forest">fix</Pill>
          <Pill mono tone="amber">verify</Pill>
          <Pill mono tone="plum">trace</Pill>
          <span className="text-[11px] text-muted ml-2">
            powered by claude-cli · works offline · MIT
          </span>
        </div>

        {/* Scroll hint */}
        <a
          href="#demo"
          className="inline-flex flex-col items-center gap-1 text-[11px] font-mono text-muted hover:text-coral transition-colors group"
          aria-label="Scroll to the 30-second demo"
        >
          <span>See it run</span>
          <span className="anim-breathe-dot inline-block text-base leading-none group-hover:text-coral">
            ▼
          </span>
        </a>
      </div>
    </section>
  );
}
