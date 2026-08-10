'use client';

import { useState } from 'react';
import { Button } from '@carbon/ui';
import {
  EmptyState,
  ErrorBanner,
  LoadingRow,
  Modal,
  Skeleton,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { api, useProjects, useRecordings } from '@/lib/hooks/api';
import {
  ApiError,
  type RecordingExchangesResponse,
  type RecordingReplayResult,
  type RecordingSummary,
} from '@/lib/api-client';
import { useSelectedProjectSlug } from '@/lib/hooks/use-project-slug';
import { getSectionCopy } from '@/lib/empty-data';
import { ProjectPicker } from './snapshots';

/**
 * Recordings section — lists per-project captures from the API, expands a row
 * inline to show its exchanges, and offers a "Replay against…" prompt that
 * calls the replay endpoint and shows per-exchange diffs. The whole page is
 * driven by real API responses; the previous placeholder is gone.
 */
export default function RecordingsSection() {
  const projects = useProjects();
  const slugs = projects.data?.data?.map((p) => p.slug) ?? [];
  const { slug, setSlug } = useSelectedProjectSlug(slugs);
  const recordings = useRecordings(slug);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<RecordingExchangesResponse | null>(null);
  const [exchangesLoading, setExchangesLoading] = useState(false);
  const [exchangesError, setExchangesError] = useState<Error | string | null>(null);

  const [replayFor, setReplayFor] = useState<string | null>(null);
  const [replayTarget, setReplayTarget] = useState('http://localhost:8787');
  const [replaying, setReplaying] = useState(false);
  const [replayResult, setReplayResult] = useState<RecordingReplayResult | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);

  async function toggleExpand(id: string) {
    if (!slug) return;
    if (expanded === id) {
      setExpanded(null);
      setExchanges(null);
      return;
    }
    setExpanded(id);
    setExchanges(null);
    setExchangesError(null);
    setExchangesLoading(true);
    try {
      setExchanges(await api.getRecordingExchanges(slug, id));
    } catch (err) {
      setExchangesError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setExchangesLoading(false);
    }
  }

  function openReplay(id: string) {
    setReplayFor(id);
    setReplayResult(null);
    setReplayError(null);
  }

  function closeReplay() {
    setReplayFor(null);
    setReplayResult(null);
    setReplayError(null);
    setReplaying(false);
  }

  async function submitReplay() {
    if (!slug || !replayFor) return;
    setReplaying(true);
    setReplayError(null);
    try {
      const result = await api.replayRecording(slug, replayFor, { targetUrl: replayTarget });
      setReplayResult(result);
    } catch (err) {
      setReplayError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setReplaying(false);
    }
  }

  return (
    <>
      <ProjectPicker
        loading={projects.loading}
        error={projects.error}
        slugs={slugs}
        selected={slug}
        onChange={setSlug}
      />

      {!slug ? (
        <EmptyState
          title="Select a project"
          description="Recordings are stored per project. Create or choose one above to see its captures."
        />
      ) : recordings.loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : recordings.error ? (
        <ErrorBanner error={recordings.error} onRetry={recordings.refetch} />
      ) : (recordings.data?.data?.length ?? 0) === 0 ? (
        <EmptyState
          title={getSectionCopy('recordings')!.emptyTitle}
          description={getSectionCopy('recordings')!.description}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Recording</Th>
              <Th>Requests</Th>
              <Th>Upstream</Th>
              <Th>Captured</Th>
              <Th>Size</Th>
              <Th className="w-44">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {recordings.data!.data.map((r) => (
              <RecordingRow
                key={r.id}
                r={r}
                expanded={expanded === r.id}
                exchanges={expanded === r.id ? exchanges : null}
                exchangesLoading={expanded === r.id && exchangesLoading}
                exchangesError={expanded === r.id ? exchangesError : null}
                onExpand={() => toggleExpand(r.id)}
                onReplay={() => openReplay(r.id)}
              />
            ))}
          </tbody>
        </Table>
      )}

      <Modal
        open={!!replayFor}
        onClose={closeReplay}
        title={`Replay ${replayFor ?? ''}`}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={closeReplay} disabled={replaying}>
              Close
            </Button>
            <Button size="sm" onClick={submitReplay} disabled={replaying || !replayTarget}>
              {replaying ? 'Replaying…' : 'Run replay'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="text-muted-foreground flex flex-col gap-1 text-xs">
            Target URL
            <input
              type="url"
              className="border-border bg-background rounded-md border px-2 py-1 text-sm"
              value={replayTarget}
              onChange={(e) => setReplayTarget(e.target.value)}
              placeholder="http://localhost:8787"
            />
          </label>
          {replayError ? <ErrorBanner error={replayError} /> : null}
          {replaying ? <LoadingRow label="Running replay" /> : null}
          {replayResult ? <ReplayResultView result={replayResult} /> : null}
        </div>
      </Modal>
    </>
  );
}

function RecordingRow({
  r,
  expanded,
  exchanges,
  exchangesLoading,
  exchangesError,
  onExpand,
  onReplay,
}: {
  r: RecordingSummary;
  expanded: boolean;
  exchanges: RecordingExchangesResponse | null;
  exchangesLoading: boolean;
  exchangesError: Error | string | null;
  onExpand: () => void;
  onReplay: () => void;
}) {
  return (
    <>
      <tr className="hover:bg-muted/30">
        <Td className="font-mono text-xs">{r.id}</Td>
        <Td>{r.requestCount}</Td>
        <Td className="text-xs">{r.upstreamUrl ?? '—'}</Td>
        <Td className="text-xs">
          {r.firstAt ? new Date(r.firstAt).toLocaleString() : '—'}
        </Td>
        <Td>{formatBytes(r.size)}</Td>
        <Td>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={onExpand}>
              {expanded ? 'Hide' : 'Exchanges'}
            </Button>
            <Button size="sm" variant="ghost" onClick={onReplay}>
              Replay
            </Button>
          </div>
        </Td>
      </tr>
      {expanded ? (
        <tr>
          <Td className="bg-muted/10">
            {exchangesLoading ? (
              <LoadingRow label="Loading exchanges" />
            ) : exchangesError ? (
              <ErrorBanner error={exchangesError} />
            ) : exchanges ? (
              <ExchangesTable exchanges={exchanges} />
            ) : null}
          </Td>
          <Td className="bg-muted/10">{null}</Td>
          <Td className="bg-muted/10">{null}</Td>
          <Td className="bg-muted/10">{null}</Td>
          <Td className="bg-muted/10">{null}</Td>
          <Td className="bg-muted/10">{null}</Td>
        </tr>
      ) : null}
    </>
  );
}

function ExchangesTable({ exchanges }: { exchanges: RecordingExchangesResponse }) {
  if (exchanges.exchanges.length === 0) {
    return <p className="text-muted-foreground text-xs">This recording has no exchanges.</p>;
  }
  return (
    <div className="max-h-64 overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <Th>Method</Th>
            <Th>URL</Th>
            <Th>Status</Th>
            <Th>Latency</Th>
          </tr>
        </thead>
        <tbody>
          {exchanges.exchanges.map((e) => (
            <tr key={e.id}>
              <Td className="font-mono">{e.method}</Td>
              <Td className="font-mono break-all">{e.url}</Td>
              <Td>{e.status}</Td>
              <Td>{e.latencyMs} ms</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReplayResultView({ result }: { result: RecordingReplayResult }) {
  const badge =
    result.status === 'ok'
      ? 'bg-emerald-500/10 text-emerald-600'
      : result.status === 'drift'
        ? 'bg-amber-500/10 text-amber-600'
        : 'bg-destructive/10 text-destructive';
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-medium ${badge}`}>{result.status}</span>
        <span className="text-muted-foreground">{result.results.length} exchange(s)</span>
      </div>
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <Th>Method</Th>
              <Th>URL</Th>
              <Th>Status</Th>
              <Th>Diff</Th>
            </tr>
          </thead>
          <tbody>
            {result.results.map((row) => (
              <tr key={row.exchangeId}>
                <Td className="font-mono">{row.method}</Td>
                <Td className="font-mono break-all">{row.url}</Td>
                <Td>
                  {row.status ?? 'ERR'} / {row.expectedStatus}
                </Td>
                <Td className="text-xs">
                  {row.diff.length === 0 ? (
                    <span className="text-emerald-600">match</span>
                  ) : (
                    row.diff.join('; ')
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
