'use client';

import Link from 'next/link';
import { ArrowRight, CircleAlert, CircleCheck, Clock3, Play, Server, ShieldCheck } from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { ErrorBanner, Skeleton } from '@/components/ui';
import { HealthPill } from '@/components/health-pill';
import { useEmulators, useProjects, useReliabilityRuns } from '@/lib/hooks/api';

const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL?.replace(/\/+$/, '') ?? 'https://carbon-web-psi.vercel.app';

export default function DashboardHome() {
  const projects = useProjects();
  const emulators = useEmulators();
  const runs = useReliabilityRuns(undefined, 8);

  return (
    <>
      <Topbar title="Overview" />
      <main className="dashboard-main space-y-7 p-8">
        <section className="dashboard-hero border-border bg-foreground text-background relative overflow-hidden border p-7 sm:p-9">
          <div className="dashboard-hero-grid" />
          <div className="relative max-w-2xl">
            <p className="dashboard-eyebrow">reliability workspace / {new Date().toISOString().slice(0, 10)}</p>
            <h2 className="mt-4 text-4xl font-medium tracking-[-0.06em] sm:text-5xl">Find the failure before your users do.</h2>
            <p className="text-background/65 mt-4 max-w-xl text-sm leading-6">Run a controlled fault against an isolated target. Carbon captures the request, compares state, and leaves you with a rerunnable report.</p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/tests" className="bg-accent text-accent-foreground inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium"><Play className="h-4 w-4" /> Run a reliability test <ArrowRight className="h-4 w-4" /></Link>
              <Link href="/runs" className="text-background/70 hover:text-background inline-flex items-center gap-2 px-2 py-2 text-sm">View run history <ArrowRight className="h-4 w-4" /></Link>
            </div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Reliability runs" value={runs.loading ? null : runs.data?.data?.length ?? 0} detail="stored reports" icon={ShieldCheck} />
          <Metric label="Passed" value={runs.loading ? null : runs.data?.data?.filter((run) => run.status === 'passed').length ?? 0} detail="state-safe outcomes" icon={CircleCheck} good />
          <Metric label="Attention" value={runs.loading ? null : runs.data?.data?.filter((run) => run.status !== 'passed').length ?? 0} detail="failed or errored" icon={CircleAlert} danger />
          <Metric label="Live targets" value={emulators.loading ? null : emulators.data?.data?.length ?? 0} detail="running emulators" icon={Server} />
        </section>

        {projects.error ? <ErrorBanner error={projects.error} onRetry={projects.refetch} /> : null}
        {runs.error ? <ErrorBanner error={runs.error} onRetry={runs.refetch} /> : null}

        <section className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
          <div className="border-border border bg-background">
            <div className="border-border flex items-center justify-between border-b px-5 py-4"><div><p className="dashboard-eyebrow">latest evidence</p><h3 className="mt-1 text-base font-medium">Run history</h3></div><Link href="/runs" className="text-muted-foreground hover:text-foreground text-xs">View all →</Link></div>
            <div className="divide-border divide-y">
              {runs.loading ? <RunSkeleton /> : runs.data?.data?.length ? runs.data.data.slice(0, 6).map((run) => <RunRow key={run.id} run={run} />) : <EmptyRuns />}
            </div>
          </div>
          <div className="border-border border bg-background">
            <div className="border-border flex items-center justify-between border-b px-5 py-4"><div><p className="dashboard-eyebrow">execution surface</p><h3 className="mt-1 text-base font-medium">Targets</h3></div><Link href="/emulators" className="text-muted-foreground hover:text-foreground text-xs">Manage →</Link></div>
            <div className="p-5">
              {emulators.loading ? <><Skeleton className="h-12 w-full" /><Skeleton className="mt-2 h-12 w-full" /></> : emulators.data?.data?.length ? <div className="space-y-3">{emulators.data.data.slice(0, 4).map((emu) => <div className="bg-muted/50 flex items-center justify-between p-3" key={emu.id}><div><div className="font-mono text-xs">{emu.id}</div><div className="text-muted-foreground mt-1 text-xs">{emu.projectSlug} · {emu.url ?? 'local runtime'}</div></div><span className="dashboard-pill dashboard-pill-ok">running</span></div>)}</div> : <div className="text-muted-foreground py-7 text-sm leading-6">Start an emulator from a project to make it available for reliability tests.</div>}
              <Link href="/tests" className="border-border text-foreground hover:bg-muted/50 mt-5 flex items-center justify-between border px-3 py-3 text-xs"><span>Choose a failure mode</span><ArrowRight className="h-4 w-4" /></Link>
            </div>
          </div>
        </section>
        <div className="flex items-center justify-between border-t pt-5"><div className="flex items-center gap-2 text-xs"><HealthPill /><span className="text-muted-foreground">The dashboard reflects the control plane it is connected to.</span></div><a href={`${MARKETING_URL}/#cli`} className="text-muted-foreground hover:text-foreground text-xs">Install CLI →</a></div>
      </main>
    </>
  );
}

function Metric({ label, value, detail, icon: Icon, good, danger }: { label: string; value: number | null; detail: string; icon: React.ComponentType<{ className?: string }>; good?: boolean; danger?: boolean }) {
  return <div className="border-border border bg-background p-4"><div className="text-muted-foreground flex items-center justify-between text-xs"><span>{label}</span><Icon className={danger ? 'text-destructive h-4 w-4' : good ? 'text-green-600 h-4 w-4' : 'text-muted-foreground h-4 w-4'} /></div><div className="mt-3 text-2xl font-medium tracking-tight">{value === null ? <Skeleton className="h-7 w-12" /> : value}</div><div className="text-muted-foreground mt-1 text-xs">{detail}</div></div>;
}

function RunRow({ run }: { run: { id: string; scenario: { title: string; id: string }; status: string; comparison: { actual: string; persistedChange: boolean }; durationMs: number; createdAt: string } }) {
  const passed = run.status === 'passed';
  return <Link href={`/runs?run=${encodeURIComponent(run.id)}`} className="hover:bg-muted/30 flex items-center gap-4 px-5 py-4 transition-colors"><span className={passed ? 'dashboard-run-icon dashboard-run-icon-ok' : 'dashboard-run-icon dashboard-run-icon-fail'}>{passed ? <CircleCheck className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}</span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><strong className="truncate text-sm font-medium">{run.scenario.title}</strong><span className="dashboard-pill">{run.scenario.id}</span></span><span className="text-muted-foreground mt-1 block truncate text-xs">{run.comparison.actual}</span></span><span className="text-muted-foreground hidden items-center gap-1 text-xs sm:flex"><Clock3 className="h-3.5 w-3.5" /> {run.durationMs}ms</span><ArrowRight className="text-muted-foreground h-4 w-4" /></Link>;
}

function RunSkeleton() { return <>{[1, 2, 3].map((value) => <div className="flex items-center gap-4 px-5 py-4" key={value}><Skeleton className="h-8 w-8 rounded-full" /><div className="flex-1"><Skeleton className="h-4 w-44" /><Skeleton className="mt-2 h-3 w-64" /></div></div>)}</>; }
function EmptyRuns() { return <div className="p-7"><p className="text-sm font-medium">No reports yet.</p><p className="text-muted-foreground mt-2 max-w-md text-sm leading-6">Run the first controlled failure against a target. The report will appear here with state evidence.</p><Link href="/tests" className="text-foreground mt-4 inline-flex items-center gap-2 text-sm underline underline-offset-4">Run a test <ArrowRight className="h-3.5 w-3.5" /></Link></div>; }
