'use client';

import { EmptyState, ErrorBanner, Skeleton } from '@/components/ui';
import { useEvents } from '@/lib/hooks/api';
import { getSectionCopy } from '@/lib/empty-data';
import { ApiError } from '@/lib/api-client';

export default function ActivitySection() {
  const events = useEvents({ limit: 100 });

  // 501/404 = the events route is not deployed on this API yet (a parallel
  // agent adds it in Phase 3). We show an honest "Not available yet" pill
  // rather than manufacturing rows.
  const notDeployed =
    events.error instanceof ApiError && (events.error.status === 404 || events.error.status === 501);

  if (events.loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  }

  if (notDeployed) {
    return (
      <EmptyState
        badge="Not available yet"
        title={getSectionCopy('activity')!.emptyTitle}
        description={getSectionCopy('activity')!.description}
      />
    );
  }

  if (events.error) {
    return <ErrorBanner error={events.error} onRetry={events.refetch} />;
  }

  const rows = events.data?.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        title={getSectionCopy('activity')!.emptyTitle}
        description={getSectionCopy('activity')!.description}
      />
    );
  }

  // Group by day for the timeline. Newest first.
  const byDay = new Map<string, typeof rows>();
  for (const row of rows) {
    const day = new Date(row.createdAt).toISOString().slice(0, 10);
    const bucket = byDay.get(day) ?? [];
    bucket.push(row);
    byDay.set(day, bucket);
  }

  return (
    <div className="space-y-8">
      {Array.from(byDay.entries()).map(([day, items]) => (
        <section key={day}>
          <h3 className="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-wide">
            {day}
          </h3>
          <ol className="border-border space-y-3 border-l pl-4">
            {items.map((e) => (
              <li key={e.id}>
                <div className="text-sm">
                  <span className="font-mono text-xs">{e.action}</span>
                  {e.projectId ? (
                    <span className="text-muted-foreground ml-2 text-xs">· project {e.projectId}</span>
                  ) : null}
                </div>
                <div className="text-muted-foreground text-xs">
                  {new Date(e.createdAt).toLocaleTimeString()} · {e.actorType}
                  {e.actorId ? ` ${e.actorId}` : ''}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
