import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Topbar } from '@/components/topbar';
import { sections, type SectionSlug } from '@/lib/empty-data';

export function generateStaticParams() {
  return Object.keys(sections).map((section) => ({ section }));
}

export default async function DashboardSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!isSectionSlug(section)) notFound();

  const data = sections[section];

  return (
    <>
      <Topbar title={data.title} />
      <main className="space-y-8 p-8">
        <section className="border-border border-y py-7">
          <div className="max-w-3xl">
            <h2 className="text-2xl font-medium tracking-tight">{data.emptyTitle}</h2>
            <p className="text-muted-foreground mt-3 text-sm leading-6">{data.description}</p>
          </div>
        </section>
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex text-sm transition-colors"
        >
          Back to overview
        </Link>
      </main>
    </>
  );
}

function isSectionSlug(section: string): section is SectionSlug {
  return section in sections;
}
