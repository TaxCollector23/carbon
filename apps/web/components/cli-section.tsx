import { Section, SectionHeading } from './section';

const commands = [
  ['carbon', 'Print the welcome screen and command list.'],
  ['carbon init', 'Create carbon.config.ts in the current directory.'],
  ['carbon login', 'Attach the CLI to a dashboard account or API key.'],
  ['carbon record <url>', 'Capture real request and response traffic.'],
  ['carbon ingest <spec>', 'Parse OpenAPI, AsyncAPI, protobuf, gRPC, Postman, HAR, or GraphQL.'],
  ['carbon emulate --from <spec>', 'Boot the deterministic local runtime.'],
  ['carbon inspect', 'Explore the resource graph in your terminal.'],
  ['carbon snapshot save <name>', 'Freeze state for reproducible tests.'],
  ['carbon replay <recording>', 'Replay captured traffic against an emulator or upstream.'],
];

export function CliSection() {
  return (
    <Section id="cli">
      <div className="grid gap-12 lg:grid-cols-[0.75fr_1.25fr] lg:items-start">
        <SectionHeading
          title="Install from the repo, then run one command."
          description="The CLI prints every available command the first time it runs, so a new install is immediately discoverable."
        />
        <div className="border-border border-y">
          <div className="border-border border-b py-4">
            <code className="break-all font-mono text-sm">
              curl -fsSL https://raw.githubusercontent.com/TaxCollector23/carbon/master/install.sh |
              sh
            </code>
          </div>
          <div className="divide-border divide-y">
            {commands.map(([cmd, desc]) => (
              <div key={cmd} className="grid gap-3 py-4 sm:grid-cols-[minmax(12rem,0.85fr)_1fr]">
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
