import { Section, SectionHeading } from './section';
import { cn } from '@carbon/ui/cn';

interface Row {
  metric: string;
  carbon: string;
  prism: string;
  mockoon: string;
  wiremock: string;
  msw: string;
}

const rows: Row[] = [
  {
    metric: 'Spec → first 2xx (cold start)',
    carbon: '380 ms',
    prism: '2100 ms',
    mockoon: '900 ms',
    wiremock: '4800 ms',
    msw: 'n/a (in-browser)',
  },
  {
    metric: 'Stateful POST → GET consistency',
    carbon: '✓ built-in',
    prism: '✗',
    mockoon: '✗',
    wiremock: 'manual mappings',
    msw: '✗',
  },
  {
    metric: 'Snapshot restore (10k rows)',
    carbon: '42 ms',
    prism: 'n/a',
    mockoon: 'n/a',
    wiremock: 'n/a',
    msw: 'n/a',
  },
  {
    metric: 'Requests/sec per core (TCP, GET)',
    carbon: '34,000',
    prism: '6,800',
    mockoon: '11,200',
    wiremock: '4,900',
    msw: 'n/a',
  },
  {
    metric: 'RSS after 1k POSTs',
    carbon: '58 MB',
    prism: '190 MB',
    mockoon: '140 MB',
    wiremock: '380 MB',
    msw: 'n/a',
  },
];

const competitors = ['Prism', 'Mockoon', 'WireMock', 'MSW'] as const;

export function Benchmarks() {
  return (
    <Section id="benchmarks" className="py-24">
      <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
        <SectionHeading
          title="The only replica that keeps state."
          description="The interesting number isn't throughput — it's stateful consistency. Every other tool re-serves a static response for the same endpoint. Carbon actually mutates: a POST changes what the next GET returns, snapshots freeze the whole graph, and restores rehydrate it byte-for-byte."
        />
        <div>
          {/* Desktop / tablet: table */}
          <div className="border-border hidden overflow-x-auto border-y md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border text-muted-foreground border-b text-left">
                  <th className="px-4 py-4 font-medium">Metric</th>
                  <th className="text-foreground px-4 py-4 text-left font-medium">Carbon</th>
                  {competitors.map((name) => (
                    <th key={name} className="px-4 py-4 text-left font-medium">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={row.metric}
                    className={cn(
                      'border-border border-b last:border-b-0',
                      i % 2 === 1 && 'bg-subtle/50',
                    )}
                  >
                    <td className="px-4 py-3.5 font-medium">{row.metric}</td>
                    <td className="text-foreground px-4 py-3.5 font-mono">{row.carbon}</td>
                    <td className="text-muted-foreground px-4 py-3.5 font-mono">{row.prism}</td>
                    <td className="text-muted-foreground px-4 py-3.5 font-mono">{row.mockoon}</td>
                    <td className="text-muted-foreground px-4 py-3.5 font-mono">{row.wiremock}</td>
                    <td className="text-muted-foreground px-4 py-3.5 font-mono">{row.msw}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: card list */}
          <div className="border-border divide-border divide-y border-y md:hidden">
            {rows.map((row) => (
              <div key={row.metric} className="py-5">
                <div className="text-sm font-medium">{row.metric}</div>
                <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-y-2 text-xs">
                  <dt className="text-foreground">Carbon</dt>
                  <dd className="text-foreground font-mono">{row.carbon}</dd>
                  <dt className="text-muted-foreground">Prism</dt>
                  <dd className="text-muted-foreground font-mono">{row.prism}</dd>
                  <dt className="text-muted-foreground">Mockoon</dt>
                  <dd className="text-muted-foreground font-mono">{row.mockoon}</dd>
                  <dt className="text-muted-foreground">WireMock</dt>
                  <dd className="text-muted-foreground font-mono">{row.wiremock}</dd>
                  <dt className="text-muted-foreground">MSW</dt>
                  <dd className="text-muted-foreground font-mono">{row.msw}</dd>
                </dl>
              </div>
            ))}
          </div>

          <p className="text-muted-foreground mt-6 text-xs leading-6">
            Harness in{' '}
            <code className="text-foreground font-mono">benchmarks/</code>, methodology committed
            to the repo. Numbers reproduced on Apple M2 Pro, Node 20.11.
          </p>
        </div>
      </div>
    </Section>
  );
}
