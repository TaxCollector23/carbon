import { Section, SectionHeading } from './section';

const layers = [
  {
    name: 'Ingestion',
    detail: 'OpenAPI · GraphQL · HAR · Postman · Live traffic · Docs',
  },
  { name: 'Parser', detail: 'Normalizes every input into one intermediate representation' },
  { name: 'Behavior graph', detail: 'Resources, relationships, transitions, side effects' },
  { name: 'State engine', detail: 'Deterministic CRUD · snapshots · rollback · persistence' },
  { name: 'Runtime', detail: 'Fastify · plugins · auth · logging · rate limits' },
  { name: 'Local API', detail: 'http://localhost:8787 · ready in <200ms' },
];

export function Architecture() {
  return (
    <Section id="architecture" className="py-24">
      <SectionHeading
        eyebrow="Architecture"
        title="A compiler pipeline for APIs."
        description="Every input flows through the same pipeline. AI helps during ingestion. The runtime itself is pure, typed, and deterministic."
      />
      <div className="mt-14 rounded-lg border border-border bg-card p-6 sm:p-10">
        <ol className="relative flex flex-col gap-3">
          {layers.map((layer, i) => (
            <li key={layer.name} className="relative">
              <div className="flex items-stretch gap-4">
                <div className="flex flex-col items-center">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background font-mono text-2xs text-muted-foreground">
                    {String(i + 1).padStart(2, '0')}
                  </div>
                  {i < layers.length - 1 ? (
                    <div className="mt-1 w-px flex-1 bg-border" aria-hidden />
                  ) : null}
                </div>
                <div className="flex-1 pb-6">
                  <div className="text-base font-medium tracking-tight">{layer.name}</div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{layer.detail}</div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}
