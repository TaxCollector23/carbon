'use client';

import { useMemo, useState } from 'react';
import { EmptyState, ErrorBanner, Skeleton, Table, Td, Th } from '@/components/ui';
import { useUsage, useUsageEvents } from '@/lib/hooks/api';
import { getSectionCopy } from '@/lib/empty-data';
import type { UsageAggregateRow } from '@/lib/api-client';

const KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All kinds' },
  { value: 'ingest', label: 'ingest' },
  { value: 'ai_call', label: 'ai_call' },
  { value: 'snapshot_saved', label: 'snapshot_saved' },
  { value: 'snapshot_restored', label: 'snapshot_restored' },
  { value: 'contract_check', label: 'contract_check' },
  { value: 'emulator_started', label: 'emulator_started' },
  { value: 'emulator_stopped', label: 'emulator_stopped' },
];

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Metered usage — aggregated totals grouped by kind for the last 30 days,
 * plus a scrollback of raw events. All admin-scoped on the API, so a
 * non-admin session lands on a 403 ErrorBanner (intentional; not silent).
 */
export default function UsageSection() {
  const [kind, setKind] = useState<string>('');

  // The since window is pinned once per mount so we don't refetch the
  // aggregate on every render (Date.now would change the dep every run).
  const since = useMemo(() => new Date(Date.now() - THIRTY_DAYS_MS).toISOString(), []);

  const aggregate = useUsage({ since, kind: kind || undefined });
  const events = useUsageEvents({ limit: 20, kind: kind || undefined });

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-medium">Usage · last 30 days</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            Totals grouped by metered event kind. Feeds usage-based billing.
          </p>
        </div>
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          Kind
          <select
            className="border-border bg-background rounded-md border px-2 py-1 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <AggregatePanel state={aggregate} />

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Recent events</h3>
        <EventsTable state={events} />
      </section>
    </div>
  );
}

function AggregatePanel({
  state,
}: {
  state: {
    data: { totals: UsageAggregateRow[]; since: string; until: string } | undefined;
    error: Error | null;
    loading: boolean;
    refetch: () => Promise<void>;
  };
}) {
  if (state.loading) return <Skeleton className="h-40" />;
  if (state.error) return <ErrorBanner error={state.error} onRetry={state.refetch} />;
  const totals = state.data?.totals ?? [];
  if (totals.length === 0) {
    return (
      <EmptyState
        title={getSectionCopy('usage')!.emptyTitle}
        description={getSectionCopy('usage')!.description}
      />
    );
  }
  return (
    <div className="space-y-4">
      <BarChart totals={totals} />
      <Table>
        <thead>
          <tr>
            <Th>Kind</Th>
            <Th className="w-32">Total</Th>
          </tr>
        </thead>
        <tbody>
          {totals.map((t) => (
            <tr key={t.kind} className="hover:bg-muted/30">
              <Td className="font-mono text-xs">{t.kind}</Td>
              <Td>{t.total.toLocaleString()}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function EventsTable({
  state,
}: {
  state: {
    data:
      | { data: Array<{ id: string; kind: string; amount: number; occurredAt: string }> }
      | undefined;
    error: Error | null;
    loading: boolean;
    refetch: () => Promise<void>;
  };
}) {
  if (state.loading) return <Skeleton className="h-32" />;
  if (state.error) return <ErrorBanner error={state.error} onRetry={state.refetch} />;
  const rows = state.data?.data ?? [];
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No events in this window.</p>;
  }
  return (
    <Table>
      <thead>
        <tr>
          <Th>When</Th>
          <Th>Kind</Th>
          <Th className="w-24">Amount</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => (
          <tr key={e.id} className="hover:bg-muted/30">
            <Td>{new Date(e.occurredAt).toLocaleString()}</Td>
            <Td className="font-mono text-xs">{e.kind}</Td>
            <Td>{e.amount}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/**
 * Hand-rolled SVG bar chart. No external chart lib — one <svg>, one bar per
 * kind, labels below, values above. Scales linearly to the largest bar.
 */
function BarChart({ totals }: { totals: UsageAggregateRow[] }) {
  const width = 640;
  const height = 200;
  const padding = { top: 20, right: 12, bottom: 44, left: 40 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const max = Math.max(1, ...totals.map((t) => t.total));
  const barW = totals.length > 0 ? Math.max(6, chartW / totals.length - 8) : 0;
  const step = totals.length > 0 ? chartW / totals.length : 0;

  return (
    <div className="border-border overflow-x-auto rounded-md border p-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Usage totals by kind"
        className="fill-foreground min-w-full"
      >
        {/* Y axis reference line */}
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={height - padding.bottom}
          className="stroke-border"
        />
        <line
          x1={padding.left}
          y1={height - padding.bottom}
          x2={width - padding.right}
          y2={height - padding.bottom}
          className="stroke-border"
        />
        {/* Y-axis max label */}
        <text
          x={padding.left - 6}
          y={padding.top + 4}
          textAnchor="end"
          className="fill-muted-foreground text-[10px]"
        >
          {max.toLocaleString()}
        </text>
        <text
          x={padding.left - 6}
          y={height - padding.bottom + 4}
          textAnchor="end"
          className="fill-muted-foreground text-[10px]"
        >
          0
        </text>

        {totals.map((t, i) => {
          const h = (t.total / max) * chartH;
          const x = padding.left + i * step + (step - barW) / 2;
          const y = height - padding.bottom - h;
          return (
            <g key={t.kind}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                className="fill-emerald-500/70"
                rx={2}
              />
              <text
                x={x + barW / 2}
                y={y - 4}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {t.total.toLocaleString()}
              </text>
              <text
                x={x + barW / 2}
                y={height - padding.bottom + 14}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {truncate(t.kind, 14)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
