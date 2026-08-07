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
    detail: 'Proto → resource graph via reflection or .proto files.',
    status: 'planned',
  },
  {
    name: 'AsyncAPI',
    detail: 'Event-driven APIs. Emulate publish/subscribe locally.',
    status: 'planned',
  },
];

export function Integrations() {
  return (
    <Section id="integrations" className="py-24">
      <SectionHeading
        eyebrow="Inputs"
        title="Anything with a schema, a spec, or a wire."
      />
      <div className="mt-12 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
        {inputs.map((i) => (
          <div key={i.name} className="flex items-start justify-between gap-6 bg-background p-6">
            <div>
              <h3 className="text-sm font-medium">{i.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{i.detail}</p>
            </div>
            <span
              className={
                'shrink-0 self-start rounded-full border px-2 py-0.5 text-2xs uppercase tracking-widest ' +
                (i.status === 'stable'
                  ? 'border-border text-foreground'
                  : 'border-dashed border-border text-muted-foreground')
              }
            >
              {i.status}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}
