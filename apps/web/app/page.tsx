import { Architecture } from '@/components/architecture';
import { CliSection } from '@/components/cli-section';
import { Comparison } from '@/components/comparison';
import { Faq } from '@/components/faq';
import { Features } from '@/components/features';
import { Hero } from '@/components/hero';
import { Integrations } from '@/components/integrations';
import { Pricing } from '@/components/pricing';
import { Problem } from '@/components/problem';
import { SdkSection } from '@/components/sdk-section';
import { Solution } from '@/components/solution';
import { Workflow } from '@/components/workflow';

export default function LandingPage() {
  return (
    <>
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
    </>
  );
}
