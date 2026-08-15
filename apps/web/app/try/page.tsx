import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Terminal } from 'lucide-react';
import { buttonVariants, cn } from '@carbon/ui';
import { Footer } from '@/components/footer';
import { Nav } from '@/components/nav';
import { Section, SectionHeading } from '@/components/section';
import { TryPlayground } from '@/components/try-playground';

export const metadata: Metadata = {
  title: 'Try Carbon — stateful API replica playground',
  description:
    'Try a stateful API replica in your browser. Create, read, and delete records with no account or API key.',
};

export default function TryPage() {
  return (
    <div className="bg-background text-foreground min-h-dvh">
      <Nav />
      <main id="main" className="pt-16">
        <Section id="try" className="pb-10 pt-20 md:pb-14 md:pt-28">
          <div className="mx-auto max-w-4xl text-center">
            <div className="text-muted-foreground font-mono text-xs uppercase tracking-[0.22em]">
              zero setup · zero credentials · real state
            </div>
            <h1 className="mt-5 text-balance text-4xl font-medium tracking-tight sm:text-6xl">
              Try the stateful part in 60 seconds.
            </h1>
            <p className="text-muted-foreground mx-auto mt-6 max-w-2xl text-pretty text-lg leading-8">
              Static mocks return fixtures. Carbon replicas remember what happened. Create a pet,
              list it, then delete it — the same behavior you get locally from{' '}
              <code className="font-mono text-sm">carbon emulate</code>.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/#cli" className={cn(buttonVariants({ size: 'lg' }), 'gap-2')}>
                <Terminal className="h-4 w-4" />
                Install the CLI
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/emulators"
                className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }))}
              >
                Browse API emulators
              </Link>
            </div>
          </div>
        </Section>
        <Section bordered={false} className="pt-0">
          <TryPlayground />
        </Section>
        <Section className="pt-8">
          <div className="grid gap-6 text-sm md:grid-cols-3">
            {[
              ['1 / mutate', 'POST creates a record in the in-memory resource store.'],
              ['2 / observe', 'GET returns the record you just created, not a frozen fixture.'],
              ['3 / reset', 'Snapshots and resets make every test run deterministic again.'],
            ].map(([title, description]) => (
              <div key={title} className="border-border border-t pt-4">
                <div className="font-mono text-xs uppercase tracking-wider">{title}</div>
                <p className="text-muted-foreground mt-2 leading-6">{description}</p>
              </div>
            ))}
          </div>
        </Section>
      </main>
      <Footer />
    </div>
  );
}
