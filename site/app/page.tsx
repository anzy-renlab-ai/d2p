import { SiteHeader } from '@/components/SiteHeader';
import { HeroSection } from '@/components/HeroSection';
import { ValueTiers } from '@/components/ValueTiers';
import { MemeWeatherShowcase } from '@/components/MemeWeatherShowcase';
import { LiveDemo } from '@/components/LiveDemo';
import { Differentiator } from '@/components/Differentiator';
import { BenchScoreboard } from '@/components/BenchScoreboard';
import { QuickStart } from '@/components/QuickStart';
import { Footer } from '@/components/Footer';

export default function Page() {
  return (
    <>
      <SiteHeader />
      <main className="anim-drift-in">
        <HeroSection />
        <ValueTiers />
        <MemeWeatherShowcase />
        <LiveDemo />
        <Differentiator />
        <BenchScoreboard />
        <QuickStart />
        <Footer />
      </main>
    </>
  );
}
