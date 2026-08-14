'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button, Input } from '@carbon/ui';
import { EmptyState, ErrorBanner, Skeleton, Table, Td, Th } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, useProjects } from '@/lib/hooks/api';
import { useAsync } from '@/lib/hooks/use-async';
import { useSelectedProjectSlug } from '@/lib/hooks/use-project-slug';
import { getSectionCopy } from '@/lib/empty-data';
import { ApiError, type DriftCheckRow, type DriftConfig, type DriftStatus } from '@/lib/api-client';
import { ProjectPicker } from './snapshots';

/**
 * Drift section — replays recorded traffic against the real upstream and
 * shows the history the drift-worker writes into `drift_checks`. Config
 * lives on the latest recording artifact's `meta` so the worker (which
 * already reads it) needs no changes.
 */
export default function DriftSection() {
  const projects = useProjects();
  const projectRows = projects.data?.data ?? [];
  const slugs = projectRows.map((p) => p.slug);
  const { slug, setSlug } = useSelectedProjectSlug(slugs);
  const currentProject = projectRows.find((p) => p.slug === slug) ?? null;
  const projectId = currentProject?.id ?? null;

  const history = useAsync(async () => {
    if (!projectId) return { data: [] };
    return api.listDriftChecks(projectId, { limit: 50 });
  }, [projectId]);

  const config = useAsync(async () => {
    if (!projectId) return null;
    return api.getDriftConfig(projectId);
  }, [projectId]);

  const [running, setRunning] = useState(false);
  const toast = useToast();

  async function onRunNow() {
    if (!projectId) return;
    setRunning(true);
    try {
      const created = await api.runDriftCheck(projectId);
      toast.push({ kind: 'success', message: `Queued drift check ${created.id}` });
      await pollForRow(projectId, created.id, history.refetch);
    } catch (err) {
      toast.push({ kind: 'error', message: err instanceof ApiError ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <ProjectPicker
        loading={projects.loading}
        error={projects.error}
        slugs={slugs}
        selected={slug}
        onChange={setSlug}
      />

      {!projectId ? (
        <EmptyState
          title="Select a project"
          description="Drift checks are stored per project. Choose one above to see its config and history."
        />
      ) : (
        <>
          <ConfigCard
            projectId={projectId}
            state={config}
            onSaved={async () => {
              await config.refetch();
            }}
          />

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">History</h3>
              <Button
                size="sm"
                onClick={onRunNow}
                disabled={running}
                data-testid="drift-run-now-button"
              >
                {running ? 'Queuing…' : 'Run now'}
              </Button>
            </div>
            <HistoryTable state={history} />
          </section>
        </>
      )}
    </div>
  );
}

/**
 * After enqueueing a drift check, poll the history endpoint a few times so
 * the freshly-inserted row shows up without a page reload.
 */
async function pollForRow(
  projectId: string,
  id: string,
  refetch: () => Promise<void>,
  attempts = 6,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    await refetch();
    try {
      const page = await api.listDriftChecks(projectId, { limit: 20 });
      if (page.data.some((r) => r.id === id)) return;
    } catch {
      /* ignore transient errors, keep polling */
    }
    await new Promise((r) => setTimeout(r, 750));
  }
}

function ConfigCard({
  projectId,
  state,
  onSaved,
}: {
  projectId: string;
  state: {
    data: DriftConfig | null | undefined;
    error: Error | null;
    loading: boolean;
    refetch: () => Promise<void>;
  };
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [upstreamUrl, setUpstreamUrl] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const c = state.data;
    if (!c) return;
    setUpstreamUrl(c.upstreamUrl ?? '');
    setIntervalMinutes(c.intervalMinutes == null ? '' : String(c.intervalMinutes));
    setEnabled(c.enabled);
  }, [state.data]);

  if (state.loading) return <Skeleton className="h-40" />;
  if (state.error) return <ErrorBanner error={state.error} onRetry={state.refetch} />;

  const c = state.data;
  const noRecording = c == null || c.configuredAt == null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const trimmed = upstreamUrl.trim();
      const parsedInterval =
        intervalMinutes.trim() === '' ? null : Number.parseInt(intervalMinutes, 10);
      await api.updateDriftConfig(projectId, {
        upstreamUrl: trimmed === '' ? null : trimmed,
        intervalMinutes:
          parsedInterval == null || Number.isNaN(parsedInterval) ? null : parsedInterval,
        enabled,
      });
      toast.push({ kind: 'success', message: 'Drift config saved' });
      await onSaved();
    } catch (err) {
      toast.push({ kind: 'error', message: err instanceof ApiError ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="border-border rounded-md border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-medium">Config</h3>
        <span className="text-muted-foreground text-xs">
          {c?.configuredAt
            ? `Backed by recording ${new Date(c.configuredAt).toLocaleString()}`
            : 'No recording yet'}
        </span>
      </div>
      {noRecording ? (
        <p className="text-muted-foreground mt-3 text-sm">
          Capture a recording (via <code className="font-mono text-xs">carbon record</code>) before
          configuring drift — the worker reads the upstream URL and cadence from the latest
          recording&apos;s metadata.
        </p>
      ) : (
        <form className="mt-4 space-y-3" onSubmit={onSubmit}>
          <label className="block text-sm">
            <span className="text-muted-foreground text-xs">Upstream URL</span>
            <Input
              type="url"
              value={upstreamUrl}
              onChange={(e) => setUpstreamUrl(e.target.value)}
              placeholder="https://api.example.com"
              data-testid="drift-upstream-url-input"
              maxLength={2048}
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground text-xs">Interval (minutes, 1–1440)</span>
            <Input
              type="number"
              min={1}
              max={24 * 60}
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(e.target.value)}
              placeholder="60"
              data-testid="drift-interval-input"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              data-testid="drift-enabled-toggle"
            />
            <span>Enabled</span>
          </label>
          <Button
            type="submit"
            size="sm"
            disabled={submitting}
            data-testid="drift-save-config-button"
          >
            {submitting ? 'Saving…' : 'Save config'}
          </Button>
        </form>
      )}
    </section>
  );
}

function HistoryTable({
  state,
}: {
  state: {
    data: { data: DriftCheckRow[] } | undefined;
    error: Error | null;
    loading: boolean;
    refetch: () => Promise<void>;
  };
}) {
  if (state.loading) return <Skeleton className="h-32" />;
  if (state.error) return <ErrorBanner error={state.error} onRetry={state.refetch} />;
  const rows = state.data?.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        title={getSectionCopy('drift')!.emptyTitle}
        description={getSectionCopy('drift')!.description}
      />
    );
  }
  return (
    <Table>
      <thead>
        <tr>
          <Th>When</Th>
          <Th>Status</Th>
          <Th>Sampled</Th>
          <Th>Mismatches</Th>
          <Th>Details</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const sampled = readNumber(r.result, 'sampled');
          const mismatches = readNumber(r.result, 'mismatches');
          const errorMessage = typeof r.result?.error === 'string' ? r.result.error : null;
          return (
            <tr key={r.id} className="hover:bg-muted/30" data-testid="drift-history-row">
              <Td>{new Date(r.ranAt ?? r.createdAt).toLocaleString()}</Td>
              <Td>
                <StatusPill status={r.status} />
              </Td>
              <Td>{sampled ?? '—'}</Td>
              <Td>{mismatches ?? '—'}</Td>
              <Td className="text-muted-foreground max-w-md truncate text-xs">
                {errorMessage ?? summariseResult(r.result)}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function StatusPill({ status }: { status: DriftStatus }) {
  const cls =
    status === 'ok'
      ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
      : status === 'drift'
        ? 'border-amber-500/40 text-amber-600 dark:text-amber-400'
        : status === 'error'
          ? 'border-destructive/40 text-destructive'
          : 'border-border text-muted-foreground';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>
      {status}
    </span>
  );
}

function readNumber(
  result: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const v = result?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function summariseResult(result: Record<string, unknown> | null | undefined): string {
  if (!result) return '';
  if (typeof result.upstreamUrl === 'string') return result.upstreamUrl;
  return '';
}
