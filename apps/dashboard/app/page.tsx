import Link from 'next/link';
import { Box, History, KeyRound, Layers, Waypoints } from 'lucide-react';
import { buttonVariants } from '@carbon/ui';
import { Topbar } from '@/components/topbar';

const sections = [
  {
    title: 'No projects yet',
    body: 'Import a spec or recording to create your first project.',
    href: '/projects',
    icon: Box,
  },
  {
    title: 'No behavior graphs yet',
    body: 'Ingest an API to build one.',
    href: '/graphs',
    icon: Waypoints,
  },
  {
    title: 'No snapshots yet',
    body: 'Save runtime state when you have a test setup worth reusing.',
    href: '/snapshots',
    icon: Layers,
  },
  {
    title: 'No recordings yet',
    body: 'Run `carbon record <url>` to capture traffic.',
    href: '/recordings',
    icon: History,
  },
  {
    title: 'No API keys yet',
    body: 'Create keys from the API when you are ready to connect CLI or CI workflows.',
    href: '/keys',
    icon: KeyRound,
  },
];

export default function DashboardHome() {
  return (
    <>
      <Topbar title="Overview" />
      <main className="space-y-8 p-8">
        <section className="border-border border-y py-7">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-medium tracking-tight">No workspace data yet</h2>
              <p className="text-muted-foreground mt-3 text-sm leading-6">
                Projects, graphs, snapshots, recordings, and keys will appear here after your
                workspace is connected.
              </p>
            </div>
            <Link href="/#cli" className={buttonVariants({ variant: 'secondary' })}>
              Install CLI
            </Link>
          </div>
        </section>

        <section className="border-border divide-y border-y">
          {sections.map(({ title, body, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="hover:bg-muted/40 group grid gap-4 py-6 transition-colors sm:grid-cols-[3rem_1fr]"
            >
              <Icon className="text-muted-foreground group-hover:text-foreground h-5 w-5 transition-colors" />
              <div>
                <h3 className="text-sm font-medium">{title}</h3>
                <p className="text-muted-foreground mt-2 text-sm leading-6">{body}</p>
              </div>
            </Link>
          ))}
        </section>
      </main>
    </>
  );
}
