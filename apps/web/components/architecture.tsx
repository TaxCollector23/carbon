import { Section, SectionHeading } from './section';

const layers = [
  {
    name: 'Ingestion',
    detail: 'OpenAPI · AsyncAPI · Protobuf · gRPC · GraphQL · HAR · Postman · Live traffic',
  },
  { name: 'Parser', detail: 'Normalizes every input into one intermediate representation' },
  { name: 'Behavior graph', detail: 'Resources, relationships, transitions, side effects' },
  { name: 'State engine', detail: 'Deterministic CRUD · snapshots · rollback · persistence' },
  { name: 'Runtime shell', detail: 'Fastify · plugins · auth · logging · rate limits' },
  { name: 'Local endpoint', detail: 'http://localhost:8787 · reference target under 1s' },
];

export function Architecture() {
  return (
    <Section id="architecture" className="py-24">
      <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
        <SectionHeading
          title="A compiler pipeline."
          description="Every input flows through the same six stages. AI runs in ingestion only."
        />
        <ol className="border-border relative border-y">
          {layers.map((layer, i) => (
            <li
              key={layer.name}
              className="border-border group grid gap-4 border-b py-5 last:border-b-0 sm:grid-cols-[4rem_1fr]"
            >
              <div className="text-muted-foreground group-hover:text-foreground font-mono text-sm transition-colors">
                {String(i + 1).padStart(2, '0')}
              </div>
              <div>
                <div className="text-base font-medium tracking-tight">{layer.name}</div>
                <div className="text-muted-foreground mt-1 font-mono text-xs leading-5">
                  {layer.detail}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}
