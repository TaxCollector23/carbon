import { Architecture } from '@/components/architecture';
import { CliSection } from '@/components/cli-section';
import { Comparison } from '@/components/comparison';
import { Faq } from '@/components/faq';
import { Features } from '@/components/features';
import { Footer } from '@/components/footer';
import { Hero } from '@/components/hero';
import { Integrations } from '@/components/integrations';
import { Nav } from '@/components/nav';
import { Pricing } from '@/components/pricing';
import { Problem } from '@/components/problem';
import { SdkSection } from '@/components/sdk-section';
import { Solution } from '@/components/solution';
import { Workflow } from '@/components/workflow';

export default function LandingPage() {
  return (
    <>
      <Nav />
      <main id="main" className="pt-16">
        <Hero />
        <Problem />
        <Solution />
        <Comparison />
        <Workflow />
        <Architecture />
        <Integrations />
        <CliSection />
        <SdkSection />
        <Features />
        <Pricing />
        <Faq />
      </main>
      <Footer />
    </>
  );
}
