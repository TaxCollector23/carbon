import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CATALOG, CATEGORY_LABELS, findEntry } from '@carbon/catalog';
import { Nav } from '@/components/nav';
import { Footer } from '@/components/footer';
import { Section, SectionHeading } from '@/components/section';

interface Params {
  readonly slug: string;
}

export function generateStaticParams(): Params[] {
  return CATALOG.map((entry) => ({ slug: entry.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const entry = findEntry(slug);
  if (!entry) return {};
  const title = `${entry.name} API Mock Server`;
  return {
    title,
    description: entry.description,
    openGraph: {
      title: `${title} — Carbon`,
      description: entry.description,
      type: 'article',
      url: `/emulators/${entry.slug}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} — Carbon`,
      description: entry.description,
    },
    alternates: { canonical: `/emulators/${entry.slug}` },
  };
}

export default async function EmulatorPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const entry = findEntry(slug);
  if (!entry) notFound();

  const firstResource = entry.seedResources?.[0] ?? 'items';
  const isRest = entry.specFormat !== 'graphql';

  return (
    <div className="bg-background text-foreground dark min-h-dvh">
      <Nav />
      <main id="main" className="pt-16">
        <Section bordered={false}>
          <div className="flex items-center gap-4">
            <span
              aria-hidden
              className="border-border bg-background flex h-12 w-12 items-center justify-center rounded-md border font-mono text-lg"
            >
              {entry.logo}
            </span>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide">
                {CATEGORY_LABELS[entry.category]} · {entry.specFormat}
              </p>
              <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">
                {entry.name} API Mock Server
              </h1>
              <p className="text-muted-foreground mt-1 text-base">{entry.tagline}</p>
            </div>
          </div>

          <p className="text-muted-foreground mt-8 max-w-2xl text-base">{entry.description}</p>

          <div className="mt-8">
            <p className="text-muted-foreground mb-2 text-xs uppercase tracking-wide">Quickstart</p>
            <pre className="border-border bg-muted/40 text-foreground w-full max-w-2xl overflow-x-auto rounded-md border px-4 py-3 font-mono text-sm">
              <code>{entry.quickstart}</code>
            </pre>
            <p className="text-muted-foreground mt-2 text-xs">
              Runs on http://localhost:8787 by default. No account, no signup.
            </p>
          </div>
        </Section>

        <Section>
          <SectionHeading title="Try it" description="Real HTTP against the local replica." />
          <div className="mt-8 space-y-6">
            {isRest ? (
              <>
                <div>
                  <p className="text-muted-foreground mb-2 text-xs uppercase tracking-wide">
                    Create a {firstResource.replace(/s$/, '')}
                  </p>
                  <pre className="border-border bg-muted/40 overflow-x-auto rounded-md border px-4 py-3 font-mono text-sm">
                    <code>{`curl -X POST http://localhost:8787/${firstResource} \\
  -H 'content-type: application/json' \\
  -d '{"name":"example"}'`}</code>
                  </pre>
                </div>
                <div>
                  <p className="text-muted-foreground mb-2 text-xs uppercase tracking-wide">
                    List them back (state persists)
                  </p>
                  <pre className="border-border bg-muted/40 overflow-x-auto rounded-md border px-4 py-3 font-mono text-sm">
                    <code>{`curl http://localhost:8787/${firstResource}`}</code>
                  </pre>
                </div>
              </>
            ) : (
              <div>
                <p className="text-muted-foreground mb-2 text-xs uppercase tracking-wide">
                  Query the local GraphQL replica
                </p>
                <pre className="border-border bg-muted/40 overflow-x-auto rounded-md border px-4 py-3 font-mono text-sm">
                  <code>{`curl -X POST http://localhost:8787/graphql \\
  -H 'content-type: application/json' \\
  -d '{"query":"{ ${firstResource.toLowerCase()}s { id title } }"}'`}</code>
                </pre>
              </div>
            )}
          </div>
        </Section>

        {entry.seedResources && entry.seedResources.length > 0 && (
          <Section>
            <SectionHeading
              title="What's covered"
              description="Carbon compiles the entire spec — these are just the resources most integrations reach for first."
            />
            <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {entry.seedResources.map((r) => (
                <li
                  key={r}
                  className="border-border bg-muted/20 rounded-md border px-3 py-2 font-mono text-sm"
                >
                  {r}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section>
          <SectionHeading
            title="Under the hood"
            description="Everything Carbon gives you comes with this emulator — for free."
          />
          <ul className="text-muted-foreground mt-8 space-y-2 text-sm">
            <li>· Stateful CRUD — writes persist across requests.</li>
            <li>· Snapshots — freeze and restore the whole world with one command.</li>
            <li>· Chaos presets — inject latency, 5xx, and network errors on demand.</li>
            <li>· Deterministic — the same requests produce the same responses in CI.</li>
          </ul>
          <div className="mt-8 flex flex-wrap gap-3 text-sm">
            <a
              href={entry.homepage}
              rel="noreferrer"
              target="_blank"
              className="border-border hover:border-foreground/40 rounded-md border px-3 py-1.5"
            >
              {entry.name} docs →
            </a>
            <Link
              href="/emulators"
              className="border-border hover:border-foreground/40 rounded-md border px-3 py-1.5"
            >
              All emulators
            </Link>
          </div>
        </Section>
      </main>
      <Footer />
    </div>
  );
}
