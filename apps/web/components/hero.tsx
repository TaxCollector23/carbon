import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Badge, buttonVariants, cn } from '@carbon/ui';
import { TerminalDemo } from './terminal';

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div aria-hidden className="absolute inset-0 grid-pattern opacity-60" />
      <div className="container relative">
        <div className="mx-auto max-w-3xl pt-24 pb-14 text-center sm:pt-32">
          <div className="mb-6 flex justify-center">
            <Badge variant="default" className="gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Now in private beta · v0.1
            </Badge>
          </div>
          <h1 className="text-balance text-4xl font-medium tracking-tight sm:text-6xl">
            Develop against production
            <br className="hidden sm:block" /> without production.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-balance text-lg text-muted-foreground">
            Carbon builds an intelligent local replica of any API. Record real traffic, infer
            behavior, and emulate it deterministically on your machine.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/get-started" className={cn(buttonVariants({ size: 'lg' }), 'gap-2')}>
              Get started
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/docs"
              className={buttonVariants({ variant: 'secondary', size: 'lg' })}
            >
              Read the docs
            </Link>
          </div>
          <p className="mt-6 font-mono text-xs text-muted-foreground">
            $ curl -fsSL install.carbon.dev | sh
          </p>
        </div>
        <div className="pb-24">
          <TerminalDemo className="mx-auto max-w-3xl" />
        </div>
      </div>
    </section>
  );
}
