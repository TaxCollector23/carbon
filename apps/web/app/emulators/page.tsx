import type { Metadata } from 'next';
import Link from 'next/link';
import { CATALOG, catalogByCategory } from '@carbon/catalog';
import { Nav } from '@/components/nav';
import { Footer } from '@/components/footer';
import { Section, SectionHeading } from '@/components/section';

export const metadata: Metadata = {
  title: 'Emulators — ready-to-run mock servers for popular APIs',
  description:
    'Ready-to-run mock servers for the APIs you already integrate with. One command boots a stateful local replica of Stripe, GitHub, OpenAI, Slack, and more.',
  openGraph: {
    title: 'Carbon Emulators',
    description:
      'One-command mock servers for popular APIs — stateful, snapshottable, deterministic.',
    type: 'website',
    url: '/emulators',
  },
};

export default function EmulatorsIndexPage() {
  const grouped = catalogByCategory();
  return (
    <div className="bg-background text-foreground min-h-dvh">
      <Nav />
      <main id="main" className="pt-16">
        <Section bordered={false}>
          <SectionHeading
            title="Emulators for the APIs you already integrate with"
            description="One command. State persistence, snapshots, chaos — all included. Every emulator below is a real, running server on your machine in under a second."
          />
          <div className="mt-8">
            <pre className="border-border bg-muted/40 text-foreground w-full max-w-xl overflow-x-auto rounded-md border px-4 py-3 font-mono text-sm">
              <code>npx carbon-api emulate --catalog stripe</code>
            </pre>
          </div>
        </Section>

        {grouped.map(({ category, label, entries }) => (
          <Section key={category}>
            <SectionHeading title={label} />
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {entries.map((entry) => (
                <Link
                  key={entry.slug}
                  href={`/emulators/${entry.slug}`}
                  className="border-border hover:border-foreground/30 bg-muted/20 hover:bg-muted/40 group flex flex-col gap-3 rounded-lg border p-5 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="border-border bg-background flex h-9 w-9 items-center justify-center rounded-md border font-mono text-sm"
                    >
                      {entry.logo}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="truncate text-base font-medium">{entry.name}</h3>
                        <span className="text-muted-foreground shrink-0 text-xs uppercase tracking-wide">
                          {entry.specFormat}
                        </span>
                      </div>
                      <p className="text-muted-foreground truncate text-sm">{entry.tagline}</p>
                    </div>
                  </div>
                  <p className="text-muted-foreground line-clamp-3 text-sm">{entry.description}</p>
                  <code className="text-foreground/80 mt-auto block truncate font-mono text-xs">
                    {entry.quickstart}
                  </code>
                </Link>
              ))}
            </div>
          </Section>
        ))}

        <Section>
          <SectionHeading
            title="Don't see your API?"
            description={
              <>
                Every OpenAPI, AsyncAPI, GraphQL, and protobuf spec works out of the box. Point{' '}
                <code className="bg-muted/60 rounded px-1.5 py-0.5 font-mono text-xs">
                  carbon emulate --from &lt;spec&gt;
                </code>{' '}
                at any URL or file and you'll have a stateful replica running locally.
              </>
            }
          />
          <p className="text-muted-foreground mt-6 text-sm">
            {CATALOG.length} curated emulators and counting. Have one you'd like added?{' '}
            <Link href="/contact" className="text-foreground underline underline-offset-4">
              Ask us to include it
            </Link>
            .
          </p>
        </Section>
      </main>
      <Footer />
    </div>
  );
}
