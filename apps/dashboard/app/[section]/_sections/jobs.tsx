'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@carbon/ui';
import { EmptyState, ErrorBanner, Skeleton, Table, Td, Th } from '@/components/ui';
import { useToast } from '@/components/toast';
import { useAsync } from '@/lib/hooks/use-async';
import { api } from '@/lib/hooks/api';
import { ApiError, type Job } from '@/lib/api-client';
import { getSectionCopy } from '@/lib/empty-data';

type StatusFilter =
  'all' | 'queued' | 'running' | 'succeeded' | 'failed' | 'needs_review' | 'deadLetter';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'failed', label: 'Failed' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'deadLetter', label: 'Dead-lettered' },
];

/**
 * Operator view of the async job queue (round 12 A2). Reads `/v1/jobs`, lets
 * an admin retry a failed non-dead-letter job, and auto-refreshes every 5s
 * while anything is queued or running so a watcher sees progress land
 * without hitting Refresh.
 */
export default function JobsSection() {
  const [status, setStatus] = useState<StatusFilter>('all');

  const jobs = useAsync(async () => {
    try {
      const params: { limit: number; status?: string } = { limit: 100 };
      if (status !== 'all') params.status = status;
      return await api.listJobs(params);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) return null;
      throw err;
    }
  }, [status]);

  const rows: Job[] = jobs.data?.data ?? [];
  const notDeployed = jobs.data === null && !jobs.loading && !jobs.error;

  const anyInFlight = useMemo(
    () => rows.some((j) => j.status === 'queued' || j.status === 'running'),
    [rows],
  );

  useEffect(() => {
    if (!anyInFlight) return;
    const id = window.setInterval(() => {
      void jobs.refetch();
    }, 5_000);
    return () => window.clearInterval(id);
  }, [anyInFlight, jobs]);

  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);

  const onRetry = useCallback(
    async (job: Job) => {
      setPending(job.id);
      try {
        await api.retryJob(job.id);
        toast.push({ kind: 'success', message: `Retrying ${job.id}` });
        await jobs.refetch();
      } catch (err) {
        toast.push({
          kind: 'error',
          message: err instanceof ApiError ? err.message : String(err),
        });
      } finally {
        setPending(null);
      }
    },
    [toast, jobs],
  );

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <p className="text-muted-foreground text-sm">
            {jobs.loading ? 'Loading…' : `${rows.length} job${rows.length === 1 ? '' : 's'}`}
          </p>
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            <span>Status</span>
            <select
              data-testid="jobs-status-filter"
              className="border-border bg-background rounded-md border px-2 py-1 text-xs"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {anyInFlight ? (
            <span className="text-muted-foreground text-xs">Live · refreshing every 5s</span>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void jobs.refetch()}
          disabled={jobs.loading}
        >
          Refresh
        </Button>
      </header>

      {notDeployed ? (
        <EmptyState
          badge="Queue off"
          title="No job queue is connected"
          description="Configure Redis and the jobs API to show async ingest and retry activity here."
        />
      ) : jobs.loading ? (
        <Skeleton className="h-24" />
      ) : jobs.error ? (
        <ErrorBanner error={jobs.error} onRetry={jobs.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={getSectionCopy('jobs')!.emptyTitle}
          description={getSectionCopy('jobs')!.description}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>ID</Th>
              <Th>Kind</Th>
              <Th className="w-36">Status</Th>
              <Th className="w-24">Attempts</Th>
              <Th className="w-40">Next attempt</Th>
              <Th>Error</Th>
              <Th className="w-24">Actions</Th>
            </tr>
          </thead>
          <tbody data-testid="jobs-table-body">
            {rows.map((job) => {
              const canRetry = job.status === 'failed' && !job.deadLetter;
              const busy = pending === job.id;
              return (
                <tr key={job.id} className="hover:bg-muted/30" data-testid={`job-row-${job.id}`}>
                  <Td>
                    <code className="text-xs">{job.id}</code>
                  </Td>
                  <Td>{job.kind}</Td>
                  <Td>
                    <StatusPill job={job} />
                  </Td>
                  <Td>
                    <span className="text-xs">
                      {job.attempts ?? 0}/{job.maxAttempts ?? '—'}
                    </span>
                  </Td>
                  <Td>
                    {job.status === 'failed' && job.nextAttemptAt ? (
                      <span className="text-muted-foreground text-xs">
                        {new Date(job.nextAttemptAt).toLocaleTimeString()}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </Td>
                  <Td>
                    {job.error ? (
                      <span className="text-destructive text-xs" title={job.error}>
                        {truncate(job.error, 80)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </Td>
                  <Td>
                    {canRetry ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        data-testid={`job-retry-${job.id}`}
                        onClick={() => void onRetry(job)}
                      >
                        {busy ? 'Retrying…' : 'Retry'}
                      </Button>
                    ) : null}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function StatusPill({ job }: { job: Job }) {
  const label = job.deadLetter ? 'deadLetter' : job.status;
  const tone = pillTone(label);
  return (
    <span
      data-testid={`job-status-${job.id}`}
      className={
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ' + tone
      }
    >
      {label}
    </span>
  );
}

function pillTone(status: string): string {
  switch (status) {
    case 'queued':
      return 'border-border text-muted-foreground bg-muted/30';
    case 'running':
      return 'border-sky-400/40 bg-sky-400/10 text-sky-600 dark:text-sky-300';
    case 'succeeded':
      return 'border-emerald-400/40 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300';
    case 'failed':
      return 'border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-300';
    case 'needs_review':
      return 'border-violet-400/40 bg-violet-400/10 text-violet-600 dark:text-violet-300';
    case 'deadLetter':
      return 'border-destructive/40 bg-destructive/10 text-destructive';
    default:
      return 'border-border text-muted-foreground';
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
