'use client';

import { useEffect, useMemo, useRef } from 'react';
import { EmptyState, ErrorBanner, Skeleton } from '@/components/ui';
import { useEventStream, useEvents } from '@/lib/hooks/api';
import { getSectionCopy } from '@/lib/empty-data';
import { ApiError, type EventRow } from '@/lib/api-client';

export default function ActivitySection() {
  const events = useEvents({ limit: 100 });
  const stream = useEventStream({ maxEvents: 200 });

  // Poll as a backup even when SSE is up — a dropped socket that hasn't
  // errored yet would otherwise leave the UI silent. 20s is slow enough not
  // to matter for a real-time transport but fast enough to catch a stale tab.
  const pollMs = stream.unsupported ? 5_000 : 20_000;
  const refetchRef = useRef(events.refetch);
  refetchRef.current = events.refetch;
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = window.setInterval(() => {
      void refetchRef.current();
    }, pollMs);
    return () => window.clearInterval(t);
  }, [pollMs]);

  // 501/404 = this API does not expose the events route in the current
  // environment. Show an empty state rather than manufacturing rows.
  const notDeployed =
    events.error instanceof ApiError &&
    (events.error.status === 404 || events.error.status === 501);

  // Merge the live stream on top of the last polled snapshot. The stream
  // supplies the newest events; older ones stay in the polled list. Dedupe
  // by id — a race between the SSE frame and the next poll can double-report.
  const merged = useMemo<EventRow[]>(() => {
    const seen = new Set<string>();
    const out: EventRow[] = [];
    for (const row of [...stream.events, ...(events.data?.data ?? [])]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
    return out;
  }, [stream.events, events.data?.data]);

  if (events.loading && merged.length === 0) {
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
        badge="Connect events"
        title={getSectionCopy('activity')!.emptyTitle}
        description={getSectionCopy('activity')!.description}
      />
    );
  }

  if (events.error && merged.length === 0) {
    return <ErrorBanner error={events.error} onRetry={events.refetch} />;
  }

  const rows = merged;
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
      <div className="text-muted-foreground text-xs">
        {stream.unsupported
          ? 'Polling every 5s (live stream unavailable).'
          : stream.connected
            ? 'Live — streaming updates.'
            : 'Reconnecting to live stream…'}
      </div>
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
                    <span className="text-muted-foreground ml-2 text-xs">
                      · project {e.projectId}
                    </span>
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
