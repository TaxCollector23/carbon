import Link from 'next/link';
import { ArrowRight, LayoutDashboard, Play, Sparkles } from 'lucide-react';
import { buttonVariants, cn } from '@carbon/ui';
import { dashboardSignInUrl } from '@/lib/urls';
import { TerminalDemo } from './terminal';

export function Hero() {
  const dashboardHref = dashboardSignInUrl('/');

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
              {[
                ['0', 'network calls to the real API during tests'],
                ['6/6', 'stateful consistency checks passed'],
                ['7.9 ms', 'p50 restore for a 10k-row snapshot'],
              ].map(([value, label], index) => (
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
