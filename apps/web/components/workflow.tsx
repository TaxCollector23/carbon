import { Section, SectionHeading } from './section';

const steps = [
  {
    number: '01',
    title: 'Point',
    body: 'Give Carbon an OpenAPI spec, AsyncAPI document, protobuf service, Postman collection, HAR file, GraphQL schema, or URL to observe.',
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
    body: 'A deterministic Fastify runtime boots on localhost. Swap your base URL and run without the upstream API.',
    command: 'carbon emulate --port 8787',
  },
  {
    number: '04',
    title: 'Snapshot',
    body: 'Freeze state, branch it, and replay it so each pull request can use the same setup.',
    command: 'carbon snapshot save "seeded-checkout"',
  },
];

export function Workflow() {
  return (
    <Section id="workflow" className="bg-subtle/50 py-24">
      <div className="grid gap-12 lg:grid-cols-[0.7fr_1.3fr]">
        <SectionHeading
          title="Four commands."
          description="Your application only needs a different base URL."
        />
        <ol className="border-border relative border-y">
          {steps.map((step) => (
            <li
              key={step.number}
              className="border-border group grid gap-5 border-b py-7 last:border-b-0 sm:grid-cols-[5rem_1fr]"
            >
              <div className="text-muted-foreground group-hover:text-foreground font-mono text-sm transition-transform group-hover:translate-x-1">
                {step.number}
              </div>
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="text-xl font-medium tracking-tight">{step.title}</h3>
                  <code className="text-muted-foreground font-mono text-xs">{step.command}</code>
                </div>
                <p className="text-muted-foreground mt-3 max-w-2xl text-sm leading-6">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}
