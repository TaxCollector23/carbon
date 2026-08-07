import { Section, SectionHeading } from './section';

const commands = [
  ['carbon init', 'Scaffold a project in the current directory.'],
  ['carbon login', 'Use API keys for account-backed workflows.'],
  ['carbon record <url>', 'Observe live traffic and build a recording.'],
  ['carbon ingest <spec>', 'Parse OpenAPI, AsyncAPI, protobuf, gRPC, Postman, HAR, or GraphQL.'],
  ['carbon emulate', 'Boot the deterministic local runtime.'],
  ['carbon inspect', 'Explore the resource graph in your terminal.'],
  ['carbon snapshot save <name>', 'Freeze state for reproducible tests.'],
  ['carbon replay <recording>', 'Replay a captured session against the same request order.'],
];

export function CliSection() {
  return (
    <Section id="cli" className="py-24">
      <div className="grid gap-12 lg:grid-cols-[0.75fr_1.25fr] lg:items-start">
        <SectionHeading
          title="Eight commands you'll use."
          description="Build and run stateful API replicas from a terminal or CI script."
        />
        <div className="border-border border-y">
          <div className="border-border flex flex-col gap-3 border-b py-4 sm:flex-row sm:items-center sm:justify-between">
            <code className="break-all font-mono text-sm">
              curl -fsSL https://raw.githubusercontent.com/TaxCollector23/carbon/master/install.sh |
              sh
            </code>
            <a
              href="#pricing"
              className="text-muted-foreground hover:text-foreground shrink-0 text-sm transition-colors"
            >
              choose plan
            </a>
          </div>
          <div className="divide-border divide-y">
            {commands.map(([cmd, desc]) => (
              <a
                key={cmd}
                href="#workflow"
                className="hover:bg-subtle/70 focus-visible:bg-subtle/70 group grid gap-3 py-4 transition-colors focus-visible:outline-none sm:grid-cols-[minmax(12rem,0.85fr)_1fr]"
              >
                <code className="text-foreground font-mono text-xs transition-transform group-hover:translate-x-1">
                  {cmd}
                </code>
                <span className="text-muted-foreground text-sm">{desc}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}
