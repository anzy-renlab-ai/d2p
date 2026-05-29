import { SiteHeader } from '@/components/SiteHeader';
import { HeroSection } from '@/components/HeroSection';
import { DemoShowcase } from '@/components/DemoShowcase';
import { ValueTiers } from '@/components/ValueTiers';
import { MemeWeatherShowcase } from '@/components/MemeWeatherShowcase';
import { DashboardGallery } from '@/components/DashboardGallery';
import { LocalDashboardLink } from '@/components/LocalDashboardLink';
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
        <div className="section-divider max-w-6xl mx-auto" aria-hidden="true" />
        <DemoShowcase />
        <div className="section-divider max-w-6xl mx-auto" aria-hidden="true" />
        <ValueTiers />
        <div className="section-divider max-w-6xl mx-auto" aria-hidden="true" />
        <MemeWeatherShowcase />
        <div className="section-divider max-w-6xl mx-auto" aria-hidden="true" />
        <DashboardGallery />
        <LocalDashboardLink />
        <LiveDemo />
        <div className="section-divider max-w-6xl mx-auto" aria-hidden="true" />
        <Differentiator />
        <div className="section-divider max-w-6xl mx-auto" aria-hidden="true" />
        <BenchScoreboard />
        <div className="section-divider max-w-6xl mx-auto" aria-hidden="true" />
        <QuickStart />
        <Footer />
      </main>
    </>
  );
}
