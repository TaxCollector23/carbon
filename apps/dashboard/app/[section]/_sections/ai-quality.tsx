'use client';

import { EmptyState, ErrorBanner, Skeleton, Table, Td, Th } from '@/components/ui';
import { useAiQualityHistory, useAiQualityLatest, useProjects } from '@/lib/hooks/api';
import { useSelectedProjectSlug } from '@/lib/hooks/use-project-slug';
import { getSectionCopy } from '@/lib/empty-data';
import type { AiQualityIssue, AiQualityReport } from '@/lib/api-client';
import { ProjectPicker } from './snapshots';

/**
 * AI-quality view: shows the groundedness scores emitted by the AI judge
 * during ingest. Latest report on top (score bar + issues), history below.
 * Reports are project-scoped, so the picker mirrors snapshots/artifacts.
 */
export default function AiQualitySection() {
  const projects = useProjects();
  const projectRows = projects.data?.data ?? [];
  const slugs = projectRows.map((p) => p.slug);
  const { slug, setSlug } = useSelectedProjectSlug(slugs);
  const currentProject = projectRows.find((p) => p.slug === slug) ?? null;
  const projectId = currentProject?.id ?? null;

  const latest = useAiQualityLatest(projectId);
  const history = useAiQualityHistory(projectId, { limit: 50 });

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
          description="AI quality reports are stored per project. Choose one above to see its history."
        />
      ) : (
        <>
          <LatestCard state={latest} />
          <HistoryTable state={history} />
        </>
      )}
    </div>
  );
}

function LatestCard({
  state,
}: {
  state: {
    data: AiQualityReport | null | undefined;
    error: Error | null;
    loading: boolean;
    refetch: () => Promise<void>;
  };
}) {
  if (state.loading) return <Skeleton className="h-40" />;
  if (state.error) return <ErrorBanner error={state.error} onRetry={state.refetch} />;
  const r = state.data;
  if (!r) {
    return (
      <EmptyState
        title={getSectionCopy('ai-quality')!.emptyTitle}
        description="Run `carbon ingest` to generate a quality report."
      />
    );
  }
  const min = numericScore(r.minScore);
  const resources = numericScore(r.resourcesScore);
  const relationships = numericScore(r.relationshipsScore);
  const issues = Array.isArray(r.issues) ? r.issues.slice(0, 5) : [];
  return (
    <section className="border-border rounded-md border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-medium">Latest report</h3>
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <span>{new Date(r.createdAt).toLocaleString()}</span>
          {r.model ? <span className="font-mono">· {r.model}</span> : null}
          {r.needsReview ? (
            <span className="border-destructive/40 text-destructive rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide">
              Needs review
            </span>
          ) : (
            <span className="border-border text-muted-foreground rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide">
              OK
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <ScoreBar label="Minimum score" value={min} />
        <ScoreBar label="Resource score" value={resources} />
        <ScoreBar label="Relationship score" value={relationships} />
      </div>

      <div className="mt-5">
        <h4 className="text-sm font-medium">Top issues</h4>
        {issues.length === 0 ? (
          <p className="text-muted-foreground mt-1 text-xs">No issues flagged in this report.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-sm">
            {issues.map((issue, i) => (
              <li key={i} className="border-border rounded-md border px-3 py-1.5">
                <IssueLine issue={issue} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function HistoryTable({
  state,
}: {
  state: {
    data: { data: AiQualityReport[]; nextCursor?: string | null } | undefined;
    error: Error | null;
    loading: boolean;
    refetch: () => Promise<void>;
  };
}) {
  if (state.loading) return <Skeleton className="h-32" />;
  if (state.error) return <ErrorBanner error={state.error} onRetry={state.refetch} />;
  const rows = state.data?.data ?? [];
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">History</h3>
      <Table>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Resource</Th>
            <Th>Relationship</Th>
            <Th>Min</Th>
            <Th>Needs review</Th>
            <Th>Issues</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-muted/30">
              <Td>{new Date(r.createdAt).toLocaleString()}</Td>
              <Td>{formatScore(r.resourcesScore)}</Td>
              <Td>{formatScore(r.relationshipsScore)}</Td>
              <Td>{formatScore(r.minScore)}</Td>
              <Td>{r.needsReview ? 'yes' : 'no'}</Td>
              <Td>{Array.isArray(r.issues) ? r.issues.length : 0}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}

function IssueLine({ issue }: { issue: AiQualityIssue }) {
  const path = typeof issue.path === 'string' ? issue.path : null;
  const message = typeof issue.message === 'string' ? issue.message : JSON.stringify(issue);
  return (
    <div className="text-sm">
      {path ? <code className="text-muted-foreground text-xs">{path}</code> : null}
      <div>{message}</div>
      {typeof issue.score === 'number' ? (
        <div className="text-muted-foreground text-xs">score: {issue.score.toFixed(2)}</div>
      ) : null}
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value)) * 100;
  const color =
    value == null
      ? 'bg-muted-foreground/40'
      : value >= 0.85
        ? 'bg-emerald-500'
        : value >= 0.6
          ? 'bg-amber-500'
          : 'bg-red-500';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{value == null ? '—' : value.toFixed(2)}</span>
      </div>
      <div className="bg-muted/50 h-2 w-full overflow-hidden rounded-full">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function numericScore(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function formatScore(v: string | number | null | undefined): string {
  const n = numericScore(v);
  return n == null ? '—' : n.toFixed(2);
}
