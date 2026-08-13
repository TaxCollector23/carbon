import { Section, SectionHeading } from './section';

const inputs = [
  {
    name: 'OpenAPI 3.x',
    detail: 'Full schema walk with $ref resolution, security schemes, examples.',
    status: 'stable',
  },
  {
    name: 'Swagger 2.0',
    detail: 'Read through the same OpenAPI adapter.',
    status: 'stable',
  },
  {
    name: 'HAR (HTTP Archive)',
    detail: 'Endpoint templates inferred from observed exchanges; id-like params detected.',
    status: 'stable',
  },
  {
    name: 'Postman v2.1',
    detail: 'Collections import as endpoints; folders map to tags.',
    status: 'stable',
  },
  {
    name: 'GraphQL SDL',
    detail: 'Types → resources, queries → get/list, mutations → create/update/delete.',
    status: 'stable',
  },
  {
    name: 'Live traffic',
    detail: 'carbon record starts an HTTP proxy that captures and redacts.',
    status: 'stable',
  },
  {
    name: 'gRPC / Protobuf',
    detail: 'Messages map to resources and service RPCs map to callable runtime endpoints.',
    status: 'supported',
  },
  {
    name: 'AsyncAPI',
    detail: 'Channels map to deterministic runtime actions for event-driven API flows.',
    status: 'supported',
  },
];

export function Integrations() {
  return (
    <Section id="integrations">
      <div className="grid gap-12 lg:grid-cols-[0.75fr_1.25fr]">
        <SectionHeading
          title="Anything with a schema, a spec, or a wire."
          description="Each source lands in the same intermediate representation, so behavior stays consistent after import."
        />
        <div className="border-border grid border-y sm:grid-cols-2">
          {inputs.map((i, index) => (
            <div
              key={i.name}
              className="border-border group border-b py-5 sm:px-5 sm:odd:border-r sm:[&:nth-last-child(-n+2)]:border-b-0"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-2xs text-muted-foreground font-mono">
                    {String(index + 1).padStart(2, '0')}
                  </div>
                  <h3 className="mt-2 text-sm font-medium">{i.name}</h3>
                </div>
                <span
                  className={
                    'text-2xs shrink-0 border px-2 py-0.5 uppercase tracking-widest transition-colors ' +
                    (i.status === 'stable' || i.status === 'supported'
                      ? 'border-foreground/20 text-foreground group-hover:bg-foreground group-hover:text-background'
                      : 'border-border text-muted-foreground border-dashed')
                  }
                >
                  {i.status}
                </span>
              </div>
              <p className="text-muted-foreground mt-3 max-w-md text-sm leading-6">{i.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
