'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, CircleAlert, Clock3, Play, RotateCcw } from 'lucide-react';
import { Button, Input } from '@carbon/ui';
import { EmptyState, ErrorBanner, Skeleton } from '@/components/ui';
import { ApiError, type ReliabilityRun, type ReliabilityScenarioId } from '@/lib/api-client';
import { api, useEmulators, useReliabilityScenarios } from '@/lib/hooks/api';
import { useToast } from '@/components/toast';

export default function TestsSection() {
  const scenarios = useReliabilityScenarios();
  const emulators = useEmulators();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<ReliabilityScenarioId>('http-outage');
  const [emulatorId, setEmulatorId] = useState('');
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/health');
  const [timeoutMs, setTimeoutMs] = useState('1000');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReliabilityRun | null>(null);

  const scenario = useMemo(() => scenarios.data?.data?.find((item) => item.id === selectedId), [scenarios.data, selectedId]);
  useEffect(() => {
    const first = emulators.data?.data?.[0];
    if (!emulatorId && first) setEmulatorId(first.id);
  }, [emulators.data, emulatorId]);
  useEffect(() => {
    if (!scenario) return;
    setMethod(scenario.defaultMethod);
    setPath(scenario.defaultPath);
    setTimeoutMs(scenario.expected === 'timeout' ? '1000' : '1000');
  }, [scenario]);

  async function runTest() {
    if (!emulatorId) return;
    setRunning(true);
    setResult(null);
    try {
      const report = await api.runReliabilityTest({
        emulatorId,
        scenario: selectedId,
        method,
        path,
        timeoutMs: Number(timeoutMs) || 1000,
      });
      setResult(report);
      toast.push({ kind: report.status === 'passed' ? 'success' : 'error', message: report.status === 'passed' ? 'Reliability test passed' : 'Reliability test found an issue' });
    } catch (err) {
      toast.push({ kind: 'error', message: err instanceof ApiError ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4"><div><p className="dashboard-eyebrow">controlled execution</p><p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">Select a failure mode, point it at an isolated target, and keep the before/after evidence with the run.</p></div><span className="dashboard-pill">8 scenarios</span></div>
      {scenarios.error ? <ErrorBanner error={scenarios.error} onRetry={scenarios.refetch} /> : null}
      {emulators.error ? <ErrorBanner error={emulators.error} onRetry={emulators.refetch} /> : null}
      {emulators.loading ? <div className="grid gap-2 sm:grid-cols-2"><Skeleton className="h-11" /><Skeleton className="h-11" /></div> : emulators.data?.data?.length ? <div className="border-border bg-background border p-5"><label className="dashboard-field-label">Target emulator</label><select value={emulatorId} onChange={(event) => setEmulatorId(event.target.value)} className="border-border bg-background mt-2 h-10 w-full border px-3 text-sm sm:max-w-md"><option value="" disabled>Choose a running target</option>{emulators.data.data.map((emulator) => <option key={emulator.id} value={emulator.id}>{emulator.id} · {emulator.projectSlug}</option>)}</select><p className="text-muted-foreground mt-2 text-xs">The target is reset to its captured baseline after each run.</p></div> : <EmptyState title="Start a target first" description="Reliability tests run against an isolated Carbon emulator. Start one from Targets, then come back here." action={<Button size="sm" onClick={() => { window.location.href = '/emulators'; }}>Open targets <ArrowRight className="ml-2 h-4 w-4" /></Button>} />}

      {scenarios.loading ? <div className="grid gap-3 md:grid-cols-2"><Skeleton className="h-28" /><Skeleton className="h-28" /></div> : <div className="grid gap-3 md:grid-cols-2">{(scenarios.data?.data ?? []).map((item) => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`border-border text-left ${item.id === selectedId ? 'border-foreground ring-1 ring-foreground' : 'hover:border-foreground/50'} border bg-background p-4 transition-colors`}><div className="flex items-start justify-between gap-3"><span className="font-medium text-sm">{item.title}</span><span className="dashboard-scenario-check">{item.id === selectedId ? <Check className="h-3.5 w-3.5" /> : null}</span></div><p className="text-muted-foreground mt-2 text-xs leading-5">{item.summary}</p><p className="text-muted-foreground mt-3 font-mono text-[10px] uppercase tracking-wide">{item.id}</p></button>)}</div>}

      {scenario && emulators.data?.data?.length ? <div className="border-border bg-background border p-5"><div className="flex items-start justify-between gap-4"><div><p className="dashboard-eyebrow">request boundary</p><h3 className="mt-2 text-base font-medium">{scenario.title}</h3><p className="text-muted-foreground mt-1 text-xs">{scenario.fault}</p></div><span className="dashboard-pill">{scenario.expected}</span></div><div className="mt-5 grid gap-3 sm:grid-cols-[110px_1fr_130px]"><label><span className="dashboard-field-label">Method</span><Input value={method} onChange={(event) => setMethod(event.target.value.toUpperCase())} /></label><label><span className="dashboard-field-label">Path</span><Input value={path} onChange={(event) => setPath(event.target.value)} /></label><label><span className="dashboard-field-label">Deadline (ms)</span><Input type="number" min={100} max={30000} value={timeoutMs} onChange={(event) => setTimeoutMs(event.target.value)} /></label></div><div className="mt-5 flex items-center justify-between gap-3 border-t pt-4"><p className="text-muted-foreground flex items-center gap-2 text-xs"><CircleAlert className="h-3.5 w-3.5" /> Demonstration faults are isolated to this target.</p><Button onClick={() => void runTest()} disabled={running || !emulatorId}><Play className="mr-2 h-4 w-4" />{running ? 'Running…' : 'Run test'}</Button></div></div> : null}
      {result ? <ResultCard result={result} /> : null}
    </div>
  );
}

function ResultCard({ result }: { result: ReliabilityRun }) {
  const passed = result.status === 'passed';
  return <section className="border-border bg-background border"><div className="border-border flex items-start justify-between gap-4 border-b p-5"><div><p className="dashboard-eyebrow">run report · {result.id}</p><h3 className="mt-2 text-xl font-medium tracking-tight">{result.comparison.actual}</h3><p className="text-muted-foreground mt-2 text-xs">{result.comparison.expected}</p></div><span className={passed ? 'dashboard-pill dashboard-pill-ok' : 'dashboard-pill dashboard-pill-fail'}>{passed ? 'passed' : result.status}</span></div><div className="grid gap-3 p-5 sm:grid-cols-3"><MiniStat label="State before" value={`${result.stateBefore.recordCount} records`} /><MiniStat label="State delta" value={`+${result.comparison.added} / -${result.comparison.removed} / ~${result.comparison.changed}`} danger={result.comparison.persistedChange} /><MiniStat label="Duration" value={`${result.durationMs}ms`} /></div><div className="border-border divide-border grid gap-0 border-t divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">{result.steps.map((step) => <div className="flex items-center gap-3 p-4" key={step.name}><span className={step.status === 'passed' ? 'dashboard-step-ok' : 'dashboard-step-fail'}>{step.status === 'passed' ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}</span><div><p className="text-xs font-medium">{step.name}</p><p className="text-muted-foreground mt-1 text-xs">{step.detail}</p></div></div>)}</div><div className="bg-muted/40 flex flex-wrap items-center justify-between gap-3 p-4"><code className="text-muted-foreground text-[11px]">{result.reproduction}</code><span className="text-muted-foreground flex items-center gap-1 text-xs"><Clock3 className="h-3.5 w-3.5" /> captured and restored</span></div></section>;
}

function MiniStat({ label, value, danger }: { label: string; value: string; danger?: boolean }) { return <div className="bg-muted/40 p-3"><p className="dashboard-field-label">{label}</p><p className={danger ? 'text-destructive mt-2 text-sm font-medium' : 'mt-2 text-sm font-medium'}>{value}</p></div>; }
