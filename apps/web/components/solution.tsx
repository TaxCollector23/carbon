import { Section, SectionHeading } from './section';

const pillars = [
  {
    title: 'A POST changes what future GETs return',
    body:
      'Carbon compiles your API into a resource graph and runs it against an in-memory state engine. Not a mock library — a small backend.',
  },
  {
    title: 'Deterministic on the request path',
    body:
      'AI runs during ingestion, never per-request. Same input, same output — for tests, for CI, for review.',
  },
  {
    title: 'Snapshot, branch, replay',
    body:
      'Freeze full state into a stable JSON blob. Commit it. Restore it in another test file, another machine, another PR.',
  },
  {
    title: 'Local process, your machine',
    body:
      'A single Node binary bound to 127.0.0.1. No egress. No cloud dependency to run it. Cloud sync is opt-in.',
  },
];

export function Solution() {
  return (
    <Section id="solution" className="py-24">
      <SectionHeading
        eyebrow="How it works"
        title="An API compiler, not a mock server."
      />
      <div className="mt-14 grid gap-6 lg:grid-cols-2">
        {pillars.map((p) => (
          <div key={p.title} className="rounded-lg border border-border bg-card p-8">
            <h3 className="text-base font-medium tracking-tight">{p.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
