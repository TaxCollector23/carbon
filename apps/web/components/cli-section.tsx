import { Section, SectionHeading } from './section';

const commands = [
  ['carbon init', 'Scaffold a project in the current directory.'],
  ['carbon login', 'Authenticate with your Carbon account.'],
  ['carbon record <url>', 'Observe live traffic and build a recording.'],
  ['carbon ingest <spec>', 'Pull in an OpenAPI, Postman, or HAR file.'],
  ['carbon emulate', 'Boot the deterministic local runtime.'],
  ['carbon inspect', 'Explore the resource graph in your terminal.'],
  ['carbon snapshot save <name>', 'Freeze state for reproducible tests.'],
  ['carbon replay <recording>', 'Deterministically replay a captured session.'],
];

export function CliSection() {
  return (
    <Section id="cli" className="py-24">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:items-start">
        <SectionHeading
          eyebrow="CLI"
          title="Eight commands you'll use."
          description="Everything the dashboard does, you can do from a terminal or a CI script."
        />
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <tbody>
              {commands.map(([cmd, desc], i) => (
                <tr
                  key={cmd}
                  className={
                    i < commands.length - 1 ? 'border-b border-border' : undefined
                  }
                >
                  <td className="w-[45%] whitespace-nowrap px-5 py-3.5 font-mono text-xs text-foreground">
                    {cmd}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}
