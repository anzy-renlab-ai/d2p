import { Pill } from './Pill';
import HeroDemo from './HeroDemo';

export function HeroSection() {
  return (
    <section className="max-w-6xl mx-auto px-6 pt-16 pb-12">
      <div className="grid grid-cols-12 gap-6 items-start">
        {/* Left — headline + CTAs */}
        <div className="col-span-12 lg:col-span-7">
          <div className="text-xs font-mono text-coral uppercase tracking-widest mb-4">
            demo · to · production
          </div>
          <h1 className="text-5xl sm:text-6xl leading-[1.05] tracking-tight mb-5">
            See what ZeroU did to your demo —{' '}
            <span className="text-coral">in 30 seconds.</span>
          </h1>
          <p className="text-lg text-muted max-w-xl leading-relaxed mb-8">
            ZeroU scans your vibe-coded demo, patches it, verifies the patch ran,
            and leaves a grep-able audit trail. Built for shipping, not for
            screenshots.
          </p>

          <div className="flex flex-wrap items-center gap-3 mb-6">
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

          <div className="flex flex-wrap items-center gap-2">
            <Pill mono tone="coral">scan</Pill>
            <Pill mono tone="forest">fix</Pill>
            <Pill mono tone="amber">verify</Pill>
            <Pill mono tone="plum">trace</Pill>
            <span className="text-[11px] text-muted ml-2">
              powered by claude-cli · works offline · MIT
            </span>
          </div>
        </div>

        {/* Right — slot for Worker B's 30s auto-play demo */}
        <div className="col-span-12 lg:col-span-5">
          <div
            data-testid="hero-demo-slot"
            id="hero-demo"
            className="aspect-[4/3] relative"
          >
            <HeroDemo />
          </div>

          <div className="mt-3 flex items-center justify-between text-[11px] text-muted px-1">
            <span className="font-mono">no sign-up · runs locally</span>
            <span className="font-mono">replay ↻</span>
          </div>
        </div>
      </div>
    </section>
  );
}
