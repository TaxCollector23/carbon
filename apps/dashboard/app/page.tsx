import Link from 'next/link';
import { ArrowUpRight, Circle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from '@carbon/ui';
import { Topbar } from '@/components/topbar';

/**
 * Dashboard overview.
 *
 * Every row here is currently seeded from static data. When the control-plane
 * API ships its list endpoints (`/v1/emulators`, `/v1/projects`, activity
 * stream), swap the arrays below for `fetch` calls — the shapes match.
 */

const stats = [
  { label: 'Running emulators', value: '2', delta: '+1 today' },
  { label: 'Requests (24h)', value: '12,481', delta: '+18%' },
  { label: 'p95 latency', value: '38ms', delta: '−4ms' },
  { label: 'Snapshots', value: '17', delta: 'across 3 projects' },
];

const emulators = [
  { id: 'emu_a3f21', project: 'stripe', port: 8787, endpoints: 142, uptime: '3h 12m' },
  { id: 'emu_b7c04', project: 'internal-billing', port: 8788, endpoints: 38, uptime: '11m' },
];

const activity = [
  { time: '2m ago', text: 'Snapshot seeded-checkout saved on stripe' },
  { time: '17m ago', text: 'Recording rec_9f3ac2 ingested (142 exchanges → 38 endpoints)' },
  { time: '1h ago', text: 'Emulator emu_a3f21 booted at :8787' },
  { time: '3h ago', text: 'API key ck_live_abc… issued to CI service account' },
  { time: '1d ago', text: 'Behavior graph rebuilt for stripe (v3 → v4)' },
];

export default function DashboardHome() {
  return (
    <>
      <Topbar title="Overview" />
      <div className="space-y-10 p-8">
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <Card key={stat.label}>
              <CardHeader>
                <CardDescription>{stat.label}</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{stat.value}</CardTitle>
                <p className="text-xs text-muted-foreground">{stat.delta}</p>
              </CardHeader>
            </Card>
          ))}
        </section>

        <section>
          <SectionHeading title="Emulators" href="/emulators" />
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-6 py-3 font-medium">ID</th>
                    <th className="px-6 py-3 font-medium">Project</th>
                    <th className="px-6 py-3 font-medium">Port</th>
                    <th className="px-6 py-3 font-medium">Endpoints</th>
                    <th className="px-6 py-3 font-medium">Uptime</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {emulators.map((e, i) => (
                    <tr
                      key={e.id}
                      className={cn(i < emulators.length - 1 && 'border-b border-border')}
                    >
                      <td className="px-6 py-4 font-mono text-xs text-muted-foreground">{e.id}</td>
                      <td className="px-6 py-4 font-medium">{e.project}</td>
                      <td className="px-6 py-4 font-mono text-xs">:{e.port}</td>
                      <td className="px-6 py-4 tabular-nums text-muted-foreground">{e.endpoints}</td>
                      <td className="px-6 py-4 text-muted-foreground">{e.uptime}</td>
                      <td className="px-6 py-4">
                        <div className="inline-flex items-center gap-1.5 text-xs">
                          <Circle className="h-2 w-2 fill-emerald-500 stroke-emerald-500" />
                          Running
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <SectionHeading title="Activity" href="/activity" />
            <Card>
              <CardContent className="p-0">
                <ul className="divide-y divide-border">
                  {activity.map((entry, i) => (
                    <li key={i} className="flex items-start justify-between gap-4 px-6 py-3.5">
                      <span className="text-sm">{entry.text}</span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {entry.time}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
          <div>
            <SectionHeading title="Quick start" />
            <Card>
              <CardContent className="p-6">
                <ol className="flex flex-col gap-4 text-sm">
                  <QuickStep n={1} title="Install the CLI">
                    <pre className="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
                      curl -fsSL install.carbon.dev | sh
                    </pre>
                  </QuickStep>
                  <QuickStep n={2} title="Ingest an API">
                    <pre className="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
                      carbon ingest ./stripe.openapi.json
                    </pre>
                  </QuickStep>
                  <QuickStep n={3} title="Boot the runtime">
                    <pre className="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
                      carbon emulate --from ./stripe.openapi.json
                    </pre>
                  </QuickStep>
                </ol>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </>
  );
}

function SectionHeading({ title, href }: { title: string; href?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-base font-medium">{title}</h2>
      {href ? (
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          View all
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </div>
  );
}

function QuickStep({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border font-mono text-xs">
        {n}
      </span>
      <div className="flex-1">
        <div className="font-medium">{title}</div>
        {children}
      </div>
    </li>
  );
}

