'use client';

import { EmptyState, ErrorBanner, Skeleton } from '@/components/ui';
import { api } from '@/lib/hooks/api';
import { useAsync } from '@/lib/hooks/use-async';
import { getSectionCopy } from '@/lib/empty-data';

/**
 * "State" as a section is really the union of every running emulator's
 * in-memory records. There is no /v1/state endpoint; we surface the
 * live emulator list as the closest honest thing until per-emulator
 * `/v1/emulators/:id/state` becomes browsable.
 */
export default function StateSection() {
  const emulators = useAsync(() => api.listEmulators(), []);
  const copy = getSectionCopy('state')!;

  if (emulators.loading)
    return (
      <div className="space-y-2">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  if (emulators.error) return <ErrorBanner error={emulators.error} onRetry={emulators.refetch} />;

  const rows = emulators.data?.data ?? [];
  if (rows.length === 0) {
    return <EmptyState title={copy.emptyTitle} description={copy.description} />;
  }
  return (
    <>
      <p className="text-muted-foreground text-sm">
        State is scoped to a running emulator. Pick one from Emulators to inspect its records
        (dedicated inspector coming soon).
      </p>
      <ul className="border-border divide-border mt-4 divide-y rounded-md border text-sm">
        {rows.map((e) => (
          <li key={e.id} className="flex items-center justify-between px-4 py-2.5">
            <span className="font-mono text-xs">{e.id}</span>
            <span className="text-muted-foreground text-xs">{e.projectSlug}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
