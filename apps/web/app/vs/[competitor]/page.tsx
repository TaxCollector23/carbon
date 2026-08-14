import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Check, Minus, X } from 'lucide-react';
import { buttonVariants, cn } from '@carbon/ui';
import { Nav } from '@/components/nav';
import { Footer } from '@/components/footer';
import { Section, SectionHeading } from '@/components/section';
import { allCompetitorSlugs, getCompetitor, type Cell, type Competitor } from '@/lib/competitors';

interface RouteParams {
  competitor: string;
}

interface PageProps {
  params: Promise<RouteParams>;
}

export function generateStaticParams(): RouteParams[] {
  return allCompetitorSlugs().map((competitor) => ({ competitor }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { competitor } = await params;
  const data = getCompetitor(competitor);
  if (!data) return { title: 'Comparison — Carbon' };
  const title = `Carbon vs ${data.name}: local mock server comparison`;
  const description = `An honest, capability-by-capability comparison of Carbon and ${data.name} (${data.tagline}). When to pick each, and where the tradeoffs actually are.`;
  return {
    title,
    description,
    openGraph: { title, description, type: 'article' },
    twitter: { card: 'summary_large_image', title, description },
    alternates: { canonical: `/vs/${data.slug}` },
  };
}

export default async function VsCompetitorPage({ params }: PageProps) {
  const { competitor } = await params;
  const data = getCompetitor(competitor);
  if (!data) notFound();
  return (
    <div className="bg-background text-foreground min-h-dvh">
      <Nav />
      <main id="main" className="pt-16">
        <VsHero data={data} />
        <VsTable data={data} />
        <VsWhen data={data} />
        <VsCta data={data} />
      </main>
      <Footer />
    </div>
  );
}

function VsHero({ data }: { data: Competitor }) {
  return (
    <Section id="vs-hero" bordered={false}>
      <div className="mx-auto max-w-3xl">
        <p className="text-muted-foreground text-sm">Comparison</p>
        <h1 className="mt-3 text-4xl font-medium tracking-tight sm:text-5xl">
          Carbon vs {data.name}
        </h1>
        <p className="text-muted-foreground mt-6 text-base leading-7">{data.lede}</p>
      </div>
    </Section>
  );
}

function Marker({ value }: { value: Cell }) {
  if (value === 'yes') return <Check className="text-foreground h-4 w-4" aria-label="Yes" />;
  if (value === 'partial')
    return <Minus className="text-muted-foreground h-4 w-4" aria-label="Partial" />;
  return <X className="text-muted-foreground/40 h-4 w-4" aria-label="No" />;
}

function VsTable({ data }: { data: Competitor }) {
  return (
    <Section id="vs-table">
      <SectionHeading
        title={`Capability by capability`}
        description={`Rows below are checked against ${data.name}'s public docs. Where support is "partial" we say what's actually there.`}
      />
      <div className="border-border mt-12 overflow-x-auto border-y">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left">
              <th className="px-6 py-4 font-medium">Capability</th>
              <th className="text-foreground px-4 py-4 text-center font-medium">Carbon</th>
              <th className="px-4 py-4 text-center font-medium">{data.name}</th>
              <th className="px-6 py-4 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr
                key={row.label}
                className={cn(
                  'border-border border-b align-top last:border-b-0',
                  i % 2 === 1 && 'bg-subtle/50',
                )}
              >
                <td className="px-6 py-3.5">{row.label}</td>
                <td className="px-4 py-3.5">
                  <div className="flex justify-center">
                    <Marker value={row.carbon} />
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex justify-center">
                    <Marker value={row.competitor} />
                  </div>
                </td>
                <td className="text-muted-foreground px-6 py-3.5 text-xs leading-5">
                  {row.note ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function VsWhen({ data }: { data: Competitor }) {
  return (
    <Section id="vs-when" className="bg-subtle/50">
      <div className="grid gap-12 lg:grid-cols-2">
        <div>
          <h2 className="text-2xl font-medium tracking-tight sm:text-3xl">
            When to pick {data.name}
          </h2>
          <ul className="text-muted-foreground mt-6 space-y-4 text-sm leading-6">
            {data.whenPickCompetitor.map((line) => (
              <li key={line} className="border-border border-l pl-4">
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-foreground text-2xl font-medium tracking-tight sm:text-3xl">
            When to pick Carbon
          </h2>
          <ul className="text-muted-foreground mt-6 space-y-4 text-sm leading-6">
            {data.whenPickCarbon.map((line) => (
              <li key={line} className="border-border border-l pl-4">
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

function VsCta({ data }: { data: Competitor }) {
  return (
    <Section id="vs-cta">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-medium tracking-tight sm:text-4xl">
          Try Carbon against your own spec.
        </h2>
        <p className="text-muted-foreground mt-4 text-base leading-7">
          One command turns any OpenAPI, GraphQL, HAR, Postman, or gRPC spec into a stateful local
          server. See how it compares to {data.name} on the endpoints you actually ship.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/gallery" className={cn(buttonVariants({ size: 'sm' }))}>
            Browse the emulator catalog
          </Link>
          <Link href="/#cli" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
            See the install command
          </Link>
        </div>
      </div>
    </Section>
  );
}
