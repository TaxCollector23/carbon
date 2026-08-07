import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { buttonVariants, cn } from '@carbon/ui';
import { Footer } from '@/components/footer';
import { Nav } from '@/components/nav';

export const metadata: Metadata = {
  title: 'Benchmarks',
  description: 'Measured Carbon runtime margins for local API emulation.',
};

const metrics = [
  {
    value: '100%',
    label: 'upstream request reduction after import',
    detail:
      'A replayed 100-request suite sends 0 requests to the upstream API when pointed at the Carbon runtime.',
  },
  {
    value: '0',
    label: 'AI calls on the request path',
    detail:
      'Inference can assist ingestion, but runtime requests are served by the compiled graph and state engine.',
  },
  {
    value: '1',
    label: 'request to restore a saved state snapshot',
    detail:
      'The runtime restores JSON state through `POST /__carbon/state/restore`, avoiding manual reseeding flows.',
  },
];

const protocolRows = [
  ['OpenAPI', 'HTTP endpoints, params, request bodies, responses, resources'],
  ['AsyncAPI', 'Channels mapped to deterministic `/asyncapi/...` runtime actions'],
  ['Protobuf', 'Messages mapped to resources and schema references'],
  ['gRPC', 'Service RPCs mapped to callable `/grpc/<Service>/<Method>` endpoints'],
  ['HAR / Postman / GraphQL', 'Recorded or declared API surfaces normalized into the same IR'],
];

export default function BenchmarksPage() {
  return (
    <div className="bg-background text-foreground dark min-h-dvh">
      <Nav />
      <main id="main" className="pt-16">
        <section className="border-border border-b py-20">
          <div className="container">
            <div className="max-w-3xl">
              <h1 className="text-balance text-5xl font-medium tracking-tight sm:text-6xl">
                Measured runtime margins.
              </h1>
              <p className="text-muted-foreground mt-6 text-lg leading-8">
                Carbon is useful when it removes upstream calls from development and CI while
                preserving stateful API behavior. These are the benchmark margins the current
                runtime is designed to protect.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/dashboard" className={cn(buttonVariants({ size: 'lg' }), 'gap-2')}>
                  Enter Dashboard
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/#cli" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
                  Install CLI
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="border-border border-b py-16">
          <div className="container">
            <div className="divide-border border-border divide-y border-y">
              {metrics.map((metric) => (
                <div key={metric.label} className="grid gap-5 py-7 md:grid-cols-[12rem_1fr]">
                  <div>
                    <div className="font-mono text-4xl font-medium">{metric.value}</div>
                    <div className="text-muted-foreground mt-2 text-sm">{metric.label}</div>
                  </div>
                  <p className="text-muted-foreground max-w-3xl text-sm leading-6">
                    {metric.detail}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="container">
            <div className="grid gap-10 lg:grid-cols-[0.7fr_1.3fr]">
              <div>
                <h2 className="text-3xl font-medium tracking-tight">What is measured</h2>
                <p className="text-muted-foreground mt-4 text-sm leading-6">
                  The benchmark compares a live integration test loop with the same requests routed
                  through a Carbon runtime after import. The useful margin is the work no longer
                  sent to the upstream service.
                </p>
              </div>
              <div className="divide-border border-border divide-y border-y">
                {protocolRows.map(([name, detail]) => (
                  <div key={name} className="grid gap-3 py-5 sm:grid-cols-[10rem_1fr]">
                    <div className="font-mono text-sm">{name}</div>
                    <div className="text-muted-foreground text-sm leading-6">{detail}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
