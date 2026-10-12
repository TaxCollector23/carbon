'use client';

import { useState } from 'react';
import { ArrowRight, CircleAlert, CircleCheck, RotateCcw } from 'lucide-react';
import { Button } from '@carbon/ui';
import { ErrorBanner, EmptyState, Skeleton } from '@/components/ui';
import { ApiError, type ReliabilityRun } from '@/lib/api-client';
import { api, useReliabilityRuns } from '@/lib/hooks/api';
import { useToast } from '@/components/toast';

export default function RunsSection() {
  const runs = useReliabilityRuns(undefined, 100);
  const toast = useToast();
  const [selected, setSelected] = useState<ReliabilityRun | null>(null);
  const [rerunning, setRerunning] = useState(false);

  async function rerun() {
    if (!selected) return;
    setRerunning(true);
    try {
      const next = await api.rerunReliabilityTest(selected.id);
      setSelected(next);
      await runs.refetch();
      toast.push({ kind: next.status === 'passed' ? 'success' : 'error', message: `Rerun ${next.status}` });
    } catch (err) {
      toast.push({ kind: 'error', message: err instanceof ApiError ? err.message : String(err) });
    } finally { setRerunning(false); }
  }

  const rows = runs.data?.data ?? [];
  return <div className="space-y-5">{runs.error ? <ErrorBanner error={runs.error} onRetry={runs.refetch} /> : null}{runs.loading ? <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div> : rows.length === 0 ? <EmptyState title="No runs yet" description="Every reliability run is saved here with its state comparison and reproduction command." /> : <div className="grid gap-5 xl:grid-cols-[1fr_380px]"><div className="border-border bg-background divide-border divide-y border">{rows.map((run) => <button type="button" key={run.id} onClick={() => setSelected(run)} className={`hover:bg-muted/30 flex w-full items-center gap-4 px-5 py-4 text-left ${selected?.id === run.id ? 'bg-muted/30' : ''}`}><span className={run.status === 'passed' ? 'dashboard-run-icon dashboard-run-icon-ok' : 'dashboard-run-icon dashboard-run-icon-fail'}>{run.status === 'passed' ? <CircleCheck className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}</span><span className="min-w-0 flex-1"><strong className="block truncate text-sm font-medium">{run.scenario.title}</strong><span className="text-muted-foreground mt-1 block truncate text-xs">{run.comparison.actual}</span></span><span className="dashboard-pill hidden sm:inline-flex">{run.status}</span><ArrowRight className="text-muted-foreground h-4 w-4" /></button>)}</div>{selected ? <RunDetail run={selected} rerun={rerun} rerunning={rerunning} /> : <div className="border-border text-muted-foreground border border-dashed p-7 text-sm leading-6">Select a run to inspect the expected/actual comparison, state delta, and rerun command.</div>}</div>}</div>;
}

function RunDetail({ run, rerun, rerunning }: { run: ReliabilityRun; rerun: () => void; rerunning: boolean }) {
  return <aside className="border-border bg-background h-fit border p-5"><div className="flex items-start justify-between gap-3"><div><p className="dashboard-eyebrow">selected report</p><h3 className="mt-2 text-lg font-medium">{run.scenario.title}</h3></div><span className={run.status === 'passed' ? 'dashboard-pill dashboard-pill-ok' : 'dashboard-pill dashboard-pill-fail'}>{run.status}</span></div><dl className="mt-5 space-y-3 text-xs"><Detail label="Request" value={`${run.request.method} ${run.request.path}`} /><Detail label="Expected" value={run.comparison.expected} /><Detail label="Actual" value={run.comparison.actual} /><Detail label="State" value={`before ${run.stateBefore.recordCount} · after ${run.stateAfter.recordCount}`} /><Detail label="Report id" value={run.id} /></dl><div className="bg-muted/40 mt-5 p-3"><p className="dashboard-field-label">reproduction</p><code className="text-muted-foreground mt-2 block break-words text-[11px]">{run.reproduction}</code></div><Button className="mt-5 w-full" variant="secondary" onClick={rerun} disabled={rerunning}><RotateCcw className="mr-2 h-4 w-4" />{rerunning ? 'Rerunning…' : 'Rerun test'}</Button></aside>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div><dt className="dashboard-field-label">{label}</dt><dd className="mt-1 break-words text-foreground">{value}</dd></div>; }
