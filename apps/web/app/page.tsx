import { Architecture } from '@/components/architecture';
import { Benchmarks } from '@/components/benchmarks';
import { CliSection } from '@/components/cli-section';
import { Comparison } from '@/components/comparison';
import { Download } from '@/components/download';
import { Faq } from '@/components/faq';
import { Features } from '@/components/features';
import { Footer } from '@/components/footer';
import { Hero } from '@/components/hero';
import { Integrations } from '@/components/integrations';
import { MetricsTest } from '@/components/metrics-test';
import { Nav } from '@/components/nav';
import { PageTracker } from '@/components/page-tracker';
import { Pricing } from '@/components/pricing';
import { Problem } from '@/components/problem';
import { Record } from '@/components/record';
import { SdkSection } from '@/components/sdk-section';
import { Solution } from '@/components/solution';
import { Workflow } from '@/components/workflow';

export default function LandingPage() {
  return (
    <div className="bg-background text-foreground min-h-dvh">
      <PageTracker action="site.view" />
      <Nav />
      {/*
       * Landing sections are ordered as a narrative:
       *   1. Hook (Hero)
       *   2. Pain (Problem)
       *   3. Fix (Solution)
       *   4. How it works — mental model first (Architecture, Workflow)
       *   5. Proof it exists — code you can copy (CLI, SDK)
       *   6. Breadth — what it plugs into (Integrations)
       *   7. Differentiation — vs alternatives, feature grid (Comparison, Features)
       *   8. Hard numbers (Benchmarks)
       *   9. Proof you can reproduce — run the test yourself (MetricsTest)
       *   10. The sharper wedge — capture prod traffic instead of a spec (Record)
       *   11. Buy (Pricing) — after they see what they're paying for
       *   12. Objections (FAQ)
       */}
      <main id="main" className="pt-16">
        <Hero />
        <Problem />
        <Solution />
        <Architecture />
        <Workflow />
        <CliSection />
        <SdkSection />
        <Integrations />
        <Comparison />
        <Features />
        <Benchmarks />
        <MetricsTest />
        <Record />
        <Download />
        <Pricing />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
