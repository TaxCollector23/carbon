import { Section, SectionHeading } from './section';

const pillars = [
  {
    title: 'POST creates a record. GET returns it.',
    body: 'Carbon infers the resource model from your spec and runs a real HTTP server on localhost:8787 that mutates in-memory like a real backend.',
  },
  {
    title: 'No AI on the request path',
    body: 'Inference happens once at ingest. Every subsequent request is deterministic, offline, and answered in microseconds.',
  },
  {
    title: 'Snapshot, rewind, replay',
    body: 'Freeze the entire server state to JSON, restore it before each test, and rewind the journal to undo any mutation by sequence number.',
  },
  {
    title: 'Same URL in your laptop and in CI',
    body: 'Boot the emulator in dev, in Docker, or in GitHub Actions. The upstream API is never called after `carbon ingest` runs.',
  },
];

export function Solution() {
  return (
    <Section id="solution">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:items-center">
        <div>
          <SectionHeading
            title="Reads your spec. Runs a real server. Remembers what you did."
            description="Carbon parses your OpenAPI, GraphQL, or gRPC contract, infers the resource model behind it, and boots an HTTP server that behaves like the real thing — with journaling, snapshots, and injectable failure modes."
          />
          <div className="border-border mt-10 border-y">
            {pillars.map((p) => (
              <div key={p.title} className="border-border border-b py-5 last:border-b-0">
                <h3 className="text-base font-medium tracking-tight">{p.title}</h3>
                <p className="text-muted-foreground mt-2 text-sm leading-6">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="border-border bg-border grid grid-cols-2 gap-px overflow-hidden border">
          {[
            ['POST', '/customers', 'creates state'],
            ['GET', '/customers/:id', 'reads mutation'],
            ['SNAPSHOT', 'seeded-checkout', 'freezes graph'],
            ['REPLAY', 'ci/pr-184', 'same result'],
          ].map(([method, path, note]) => (
            <div key={method} className="solution-cell bg-background group p-6">
              <div className="text-2xs text-muted-foreground font-mono uppercase tracking-widest">
                {method}
              </div>
              <div className="text-foreground mt-3 font-mono text-sm">{path}</div>
              <div className="text-muted-foreground mt-2 text-sm leading-6">{note}</div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
