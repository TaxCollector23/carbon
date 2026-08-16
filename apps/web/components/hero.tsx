import Link from 'next/link';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ArrowRight, LayoutDashboard, Play, Sparkles } from 'lucide-react';
import { buttonVariants, cn } from '@carbon/ui';
import { dashboardSignInUrl } from '@/lib/urls';
import { TerminalDemo } from './terminal';

interface HeroStat {
  readonly value: string;
  readonly label: string;
}

/**
 * Read the committed benchmark results at build time so the hero's proof
 * points stay current with the suite instead of drifting out of date. Falls
 * back to the last-known-good numbers when the file is absent (e.g. a fresh
 * clone before the first `pnpm bench` run).
 */
function heroStats(): HeroStat[] {
  const fallback: HeroStat[] = [
    { value: '0', label: 'network calls to the real API during tests' },
    { value: '6/6', label: 'stateful consistency checks passed' },
    { value: '7.9 ms', label: 'p50 restore for a 10k-row snapshot' },
  ];
  try {
    const path = join(process.cwd(), '..', '..', 'benchmarks', 'results', 'latest.json');
    const results = JSON.parse(readFileSync(path, 'utf8')) as {
      results?: {
        stateful?: { passed?: boolean; stepCount?: number };
        snapshot?: { totalRows?: number; restoreMs?: { p50?: number } };
      };
    };
    const stateful = results.results?.stateful;
    const snapshot = results.results?.snapshot;
    return [
      { value: '0', label: 'network calls to the real API during tests' },
      stateful?.stepCount
        ? {
            value: `${stateful.passed ? stateful.stepCount : 0}/${stateful.stepCount}`,
            label: 'stateful consistency checks passed',
          }
        : fallback[1]!,
      snapshot?.restoreMs?.p50 != null && snapshot.totalRows != null
        ? {
            value: `${snapshot.restoreMs.p50.toFixed(1)} ms`,
            label: `p50 restore for a ${formatK(snapshot.totalRows)}-row snapshot`,
          }
        : fallback[2]!,
    ];
  } catch {
    return fallback;
  }
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

export function Hero() {
  const dashboardHref = dashboardSignInUrl('/');
  const stats = heroStats();

  return (
    <section id="top" className="border-border bg-background relative overflow-hidden border-b">
      <div className="container relative">
        <div className="grid min-h-[calc(100svh-4rem)] gap-12 py-14 sm:py-20 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div className="animate-rise max-w-3xl">
            <h1 className="max-w-4xl text-balance text-5xl font-medium tracking-tight sm:text-7xl lg:text-[5.25rem] lg:leading-[0.92]">
              Carbon runs a stateful replica of your API.
            </h1>
            <p className="text-muted-foreground mt-7 max-w-2xl text-pretty text-lg leading-8 sm:text-xl">
              Run{' '}
              <code className="font-mono text-base">
                carbon emulate --from spec.yaml --port 8787
              </code>{' '}
              and get a deterministic local server for development and CI. POSTs create records,
              GETs return them, and snapshots reset the runtime between tests.
            </p>
            <p className="text-muted-foreground/80 mt-4 max-w-2xl text-sm leading-6">
              Carbon compiles OpenAPI, AsyncAPI, GraphQL, HAR, Postman, protobuf descriptors, and
              gRPC service contracts into the same stateful HTTP runtime.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href={dashboardHref}
                className={cn(buttonVariants({ size: 'lg' }), 'group gap-2')}
              >
                <LayoutDashboard className="h-4 w-4" />
                Enter Dashboard
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/try"
                className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }), 'group gap-2')}
              >
                <Sparkles className="h-4 w-4" />
                Try it now
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="#cli"
                className={cn(buttonVariants({ variant: 'ghost', size: 'lg' }), 'group gap-2')}
              >
                Install CLI
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="#workflow"
                className={cn(buttonVariants({ variant: 'ghost', size: 'lg' }), 'group')}
              >
                <Play className="h-4 w-4 fill-current" />
                See workflow
              </Link>
            </div>
            <div className="border-border mt-8 grid max-w-xl grid-cols-3 border-y text-sm">
              {stats.map(({ value, label }, index) => (
                <div key={label} className={cn('py-4', index > 0 && 'border-border border-l pl-5')}>
                  <div className="text-foreground font-mono text-base">{value}</div>
                  <div className="text-muted-foreground mt-1 text-xs">{label}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="animate-rise relative [animation-delay:120ms]">
            <div className="border-border text-muted-foreground mb-4 flex items-center justify-between border-y py-3 text-xs">
              <span className="font-mono">carbon emulate --port 8787</span>
              <span className="text-foreground font-mono">example output</span>
            </div>
            <TerminalDemo className="terminal-float" />
            <div className="border-border bg-border mt-4 grid grid-cols-3 gap-px overflow-hidden border text-xs">
              {['capture', 'compile', 'replay'].map((step, index) => (
                <a
                  key={step}
                  href={`#${index === 0 ? 'integrations' : index === 1 ? 'architecture' : 'workflow'}`}
                  className="bg-background text-muted-foreground hover:bg-subtle hover:text-foreground focus-visible:bg-subtle focus-visible:text-foreground px-4 py-3 font-mono transition-colors focus-visible:outline-none"
                >
                  {String(index + 1).padStart(2, '0')} / {step}
                </a>
              ))}
            </div>
          </div>
        </div>
        <div className="border-border text-muted-foreground flex flex-wrap items-center gap-x-8 gap-y-3 border-t py-5 text-xs uppercase tracking-widest">
          <span>OpenAPI</span>
          <span>AsyncAPI</span>
          <span>gRPC descriptors</span>
          <span>Protobuf</span>
          <span>HAR</span>
          <span>GraphQL</span>
        </div>
      </div>
    </section>
  );
}
