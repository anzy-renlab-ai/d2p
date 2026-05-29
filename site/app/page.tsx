import { SiteHeader } from '@/components/SiteHeader';
import { HeroSection } from '@/components/HeroSection';
import { DemoShowcase } from '@/components/DemoShowcase';
import { ValueTiers } from '@/components/ValueTiers';
import { MemeWeatherShowcase } from '@/components/MemeWeatherShowcase';
import { DashboardGallery } from '@/components/DashboardGallery';
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
        <DemoShowcase />
        <ValueTiers />
        <MemeWeatherShowcase />
        <DashboardGallery />
        <LiveDemo />
        <Differentiator />
        <BenchScoreboard />
        <QuickStart />
        <Footer />
      </main>
    </>
  );
}
