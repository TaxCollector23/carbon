import { Section, SectionHeading } from './section';

const pillars = [
  {
    title: 'A POST changes what future GETs return',
    body: 'Carbon compiles resources, relationships, and transitions into a runtime your app can call.',
  },
  {
    title: 'Deterministic on the request path',
    body: 'After ingestion, request handling runs without AI calls on the request path.',
  },
  {
    title: 'Snapshot, branch, replay',
    body: 'Save runtime state as JSON and restore it in another test file, machine, or pull request.',
  },
  {
    title: 'Same base URL locally and in CI',
    body: 'Use the same runtime in development and CI without calling the upstream API after import.',
  },
];

export function Solution() {
  return (
    <Section id="solution" className="py-24">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:items-center">
        <div>
          <SectionHeading
            title="Compile API behavior into a stateful runtime."
            description="Carbon turns API shape and observed behavior into a runtime your application can mutate."
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
        <div className="border-border bg-background relative min-h-[430px] overflow-hidden border p-6">
          <div className="bg-border absolute inset-x-6 top-1/2 h-px" />
          <div className="bg-border absolute inset-y-6 left-1/2 w-px" />
          <div className="bg-border relative grid h-full grid-cols-2 gap-px">
            {[
              ['POST', '/customers', 'creates state'],
              ['GET', '/customers/:id', 'reads mutation'],
              ['SNAPSHOT', 'seeded-checkout', 'freezes graph'],
              ['REPLAY', 'ci/pr-184', 'same result'],
            ].map(([method, path, note]) => (
              <div key={method} className="solution-cell bg-background group p-5">
                <div className="text-2xs text-muted-foreground font-mono uppercase">{method}</div>
                <div className="text-foreground mt-3 font-mono text-sm">{path}</div>
                <div className="text-muted-foreground mt-2 text-sm">{note}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}
