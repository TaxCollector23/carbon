'use client';

import Link from 'next/link';
import { Box, KeyRound, Layers, Server } from 'lucide-react';
import { Button } from '@carbon/ui';
import { Topbar } from '@/components/topbar';
import { ErrorBanner, Skeleton } from '@/components/ui';
import { useApiKeys, useEmulators, useProjects } from '@/lib/hooks/api';
import { useSelectedProjectSlug } from '@/lib/hooks/use-project-slug';
import { useSnapshots } from '@/lib/hooks/api';
import { getSectionCopy } from '@/lib/empty-data';
import { HealthPill } from '@/components/health-pill';

/**
 * Overview page. Fetches counts+recent items for the four resources that
 * have real backends today (projects/snapshots/emulators/api-keys) and
 * renders honest skeleton/error states in place of the old static tiles.
 *
 * Snapshots are project-scoped on the API, so the count shown is for the
 * currently selected project (see useSelectedProjectSlug).
 */
export default function DashboardHome() {
  const projects = useProjects();
  const emulators = useEmulators();
  const keys = useApiKeys();

  const availableSlugs = projects.data?.data?.map((p) => p.slug) ?? [];
  const { slug: projectSlug } = useSelectedProjectSlug(availableSlugs);
  const snapshots = useSnapshots(projectSlug);

  return (
    <>
      <Topbar title="Overview" />
      <main className="space-y-8 p-8">
        <section className="border-border border-y py-7">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-medium tracking-tight">Workspace overview</h2>
              <p className="text-muted-foreground mt-3 text-sm leading-6">
                Live totals from the control plane. Numbers reflect the API server this
                dashboard is pointed at ({process.env.NEXT_PUBLIC_CARBON_API_URL ?? 'http://localhost:3000'}).
              </p>
            </div>
            <div className="flex items-center gap-3">
              <HealthPill />
              <Link href="/#cli" className="text-muted-foreground hover:text-foreground text-sm">
                Install CLI →
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            icon={Box}
            title="Projects"
            loading={projects.loading}
            error={projects.error}
            count={projects.data?.total ?? projects.data?.data?.length}
            href="/projects"
          />
          <StatTile
            icon={Layers}
            title={projectSlug ? `Snapshots · ${projectSlug}` : 'Snapshots'}
            loading={snapshots.loading}
            error={snapshots.error}
            count={snapshots.data?.data?.length}
            href="/snapshots"
          />
          <StatTile
            icon={Server}
            title="Emulators"
            loading={emulators.loading}
            error={emulators.error}
            count={emulators.data?.data?.length}
            href="/emulators"
          />
          <StatTile
            icon={KeyRound}
            title="API keys"
            loading={keys.loading}
            error={keys.error}
            count={keys.data?.data?.length}
            href="/keys"
          />
        </section>

        {projects.error ? (
          <ErrorBanner error={projects.error} onRetry={projects.refetch} />
        ) : null}

        <section className="grid gap-6 lg:grid-cols-2">
          <RecentList
            title="Recent projects"
            href="/projects"
            loading={projects.loading}
            error={projects.error}
            items={
              projects.data?.data?.slice(0, 5).map((p) => ({
                key: p.id,
                primary: p.name,
                secondary: p.slug,
              })) ?? []
            }
            emptyKey="projects"
          />
          <RecentList
            title="Recent API keys"
            href="/keys"
            loading={keys.loading}
            error={keys.error}
            items={
              keys.data?.data?.slice(0, 5).map((k) => ({
                key: k.id,
                primary: k.name,
                secondary: `${k.prefix}… · ${k.scopes.join(', ')}`,
              })) ?? []
            }
            emptyKey="keys"
          />
        </section>
      </main>
    </>
  );
}

function StatTile({
  icon: Icon,
  title,
  count,
  loading,
  error,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number | undefined | null;
  loading: boolean;
  error: Error | null;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="border-border hover:bg-muted/30 group block rounded-md border p-4 transition-colors"
    >
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <Icon className="h-3.5 w-3.5" /> {title}
      </div>
      <div className="mt-2 text-2xl font-medium tracking-tight">
        {loading ? (
          <Skeleton className="h-7 w-12" />
        ) : error ? (
          <span className="text-destructive text-sm font-normal">error</span>
        ) : (
          (count ?? 0)
        )}
      </div>
    </Link>
  );
}

function RecentList({
  title,
  href,
  loading,
  error,
  items,
  emptyKey,
}: {
  title: string;
  href: string;
  loading: boolean;
  error: Error | null;
  items: Array<{ key: string; primary: string; secondary?: string }>;
  emptyKey: string;
}) {
  const empty = getSectionCopy(emptyKey);
  return (
    <div className="border-border rounded-md border">
      <div className="border-border flex items-center justify-between border-b px-4 py-2.5">
        <h3 className="text-sm font-medium">{title}</h3>
        <Link href={href} className="text-muted-foreground hover:text-foreground text-xs">
          View all
        </Link>
      </div>
      <div className="divide-border divide-y">
        {loading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : error ? (
          <p className="text-destructive px-4 py-6 text-sm">{error.message}</p>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground px-4 py-6 text-sm">
            {empty?.emptyTitle ?? 'Nothing yet.'}
          </p>
        ) : (
          items.map((item) => (
            <div key={item.key} className="px-4 py-2.5">
              <div className="text-sm font-medium">{item.primary}</div>
              {item.secondary ? (
                <div className="text-muted-foreground mt-0.5 text-xs">{item.secondary}</div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Silence "unused" if Button import is stripped in future iterations.
export const _Button = Button;
