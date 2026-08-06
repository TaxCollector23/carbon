import { Section, SectionHeading } from './section';

const steps = [
  {
    number: '01',
    title: 'Point',
    body: 'Give Carbon an OpenAPI spec, a Postman collection, a HAR file, or a live URL to observe.',
    command: 'carbon record https://api.stripe.com',
  },
  {
    number: '02',
    title: 'Analyze',
    body: 'The ingestion pipeline builds an intermediate representation and a behavior graph — resources, relationships, transitions.',
    command: 'carbon inspect',
  },
  {
    number: '03',
    title: 'Emulate',
    body: 'A deterministic Fastify runtime boots on localhost. Swap your base URL. Everything keeps working — offline, in CI, on a plane.',
    command: 'carbon emulate --port 8787',
  },
  {
    number: '04',
    title: 'Snapshot',
    body: 'Freeze state, branch it, replay it. Ship reproducible fixtures with every pull request.',
    command: 'carbon snapshot save "seeded-checkout"',
  },
];

export function Workflow() {
  return (
    <Section id="workflow" className="py-24">
      <SectionHeading
        eyebrow="Developer workflow"
        title="Four commands. Zero surprises."
        description="Carbon fits into the workflow you already have. It does not ask you to change your codebase, your framework, or your tests."
      />
      <ol className="mt-14 grid gap-6 md:grid-cols-2">
        {steps.map((step) => (
          <li
            key={step.number}
            className="flex flex-col gap-4 rounded-lg border border-border bg-card p-8"
          >
            <div className="flex items-center gap-3">
              <span className="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
                {step.number}
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <h3 className="text-lg font-medium tracking-tight">{step.title}</h3>
            <p className="text-sm text-muted-foreground">{step.body}</p>
            <code className="mt-auto rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground">
              {step.command}
            </code>
          </li>
        ))}
      </ol>
    </Section>
  );
}
