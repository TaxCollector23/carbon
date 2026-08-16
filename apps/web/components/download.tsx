import Link from 'next/link';
import { ArrowUpRight, Download as DownloadIcon, MonitorDown, Terminal, FileCode2 } from 'lucide-react';
import { buttonVariants, cn } from '@carbon/ui';
import { Section, SectionHeading } from './section';

const RELEASES_URL = 'https://github.com/TaxCollector23/carbon/releases/latest';
const MACOS_APP_URL =
  'https://github.com/TaxCollector23/carbon/releases/download/v0.2.1/Carbon-Desktop-0.1.0-macos-arm64.zip';

function Card({
  icon: Icon,
  title,
  tagline,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  tagline: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border bg-background/40 flex flex-col border-y p-6">
      <div className="flex items-center gap-3">
        <Icon className="text-muted-foreground h-5 w-5" />
        <h3 className="text-base font-semibold">{title}</h3>
      </div>
      <p className="text-muted-foreground mt-2 text-sm">{tagline}</p>
      <div className="mt-5 flex flex-1 flex-col gap-3">{children}</div>
    </div>
  );
}

export function Download() {
  return (
    <Section id="download">
      <SectionHeading
        title="Get Carbon"
        description="A native desktop app, a single-binary CLI, and language clients — same stateful runtime underneath."
      />
      <div className="mt-12 grid gap-8 lg:grid-cols-3">
        <Card
          icon={MonitorDown}
          title="Desktop app"
          tagline="Run emulators and watch live state from a native window. macOS (Apple silicon) today; Windows and Linux from source."
        >
          <Link
            href={MACOS_APP_URL}
            className={cn(buttonVariants(), 'group justify-between')}
            target="_blank"
            rel="noreferrer"
          >
            <span className="flex items-center gap-2">
              <DownloadIcon className="h-4 w-4" />
              Download for macOS
            </span>
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
          <Link
            href={RELEASES_URL}
            className={cn(buttonVariants({ variant: 'ghost' }), 'text-sm')}
            target="_blank"
            rel="noreferrer"
          >
            Standalone CLI for Windows &amp; Linux
          </Link>
          <p className="text-muted-foreground text-xs leading-5">
            The desktop app is an unsigned early beta — right-click → Open to
            bypass Gatekeeper.
          </p>
        </Card>

        <Card icon={Terminal} title="Command line" tagline="One command to install, no runtime dependencies.">
          <code className="bg-muted/40 text-foreground rounded-md px-3 py-2 font-mono text-sm">
            npm i -g carbon-api
          </code>
          <code className="bg-muted/40 text-foreground rounded-md px-3 py-2 font-mono text-sm">
            brew install carbon-dev/carbon/carbon
          </code>
          <Link
            href={RELEASES_URL}
            className={cn(buttonVariants({ variant: 'ghost' }), 'text-sm')}
            target="_blank"
            rel="noreferrer"
          >
            Standalone binaries + checksums
          </Link>
        </Card>

        <Card icon={FileCode2} title="Language clients" tagline="Typed clients for the control-plane API, generated from the same schema.">
          <code className="bg-muted/40 text-foreground rounded-md px-3 py-2 font-mono text-sm">
            pip install carbon-client
          </code>
          <code className="bg-muted/40 text-foreground rounded-md px-3 py-2 font-mono text-sm">
            npm i @carbon/client
          </code>
          <p className="text-muted-foreground text-xs leading-5">
            Full sync + async surfaces for every route, with cursor pagination.
          </p>
        </Card>
      </div>
    </Section>
  );
}
