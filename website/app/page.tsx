import { Hero } from './components/Hero';
import { DemoTheater } from './components/DemoTheater';
import { HowItWorks } from './components/HowItWorks';
import { Features } from './components/Features';
import { CaseStudy } from './components/CaseStudy';
import { TechCredibility } from './components/TechCredibility';
import { Cta } from './components/Cta';
import { Footer } from './components/Footer';

export default function Page() {
  return (
    <main>
      <Hero />
      <DemoTheater />
      <HowItWorks />
      <div id="features">
        <Features />
      </div>
      <CaseStudy />
      <TechCredibility />
      <Cta />
      <Footer />
    </main>
  );
}
