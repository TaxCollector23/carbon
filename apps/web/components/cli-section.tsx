import { Section, SectionHeading } from './section';

const commands = [
  ['carbon init', 'Scaffold a project in the current directory.'],
  ['carbon record <url>', 'Observe live traffic and build a recording.'],
  ['carbon ingest <spec>', 'Parse OpenAPI, AsyncAPI, protobuf, gRPC, Postman, HAR, or GraphQL.'],
  ['carbon emulate', 'Boot the deterministic local runtime.'],
  ['carbon inspect', 'Explore the resource graph in your terminal.'],
  ['carbon snapshot save <name>', 'Freeze state for reproducible tests.'],
];

export function CliSection() {
  return (
    <Section id="cli">
      <div className="grid gap-12 lg:grid-cols-[0.75fr_1.25fr] lg:items-start">
        <SectionHeading
          title="Six commands to a replica."
          description="Build and run stateful API replicas from a terminal or CI script."
        />
        <div className="border-border border-y">
          <div className="border-border border-b py-4">
            <code className="break-all font-mono text-sm">npm install -g carbon-dev</code>
          </div>
          <div className="divide-border divide-y">
            {commands.map(([cmd, desc]) => (
              <div
                key={cmd}
                className="grid gap-3 py-4 sm:grid-cols-[minmax(12rem,0.85fr)_1fr]"
              >
                <code className="text-foreground font-mono text-xs">{cmd}</code>
                <span className="text-muted-foreground text-sm">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}
