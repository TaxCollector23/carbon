'use client';

import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@carbon/ui/cn';
import { Section, SectionHeading } from './section';

const items = [
  {
    q: 'Is the runtime deterministic?',
    a: 'Yes. Once an API is analyzed, the runtime is pure — same input, same output, every time. AI is used only during ingestion, never in the request path.',
  },
  {
    q: 'How is this different from a mocking library?',
    a: 'Mocks return static responses. Carbon models state, relationships, transitions, and side effects. A POST changes what future GETs return.',
  },
  {
    q: 'Do you send our API traffic anywhere?',
    a: 'No. The runtime runs entirely on your machine. Cloud sync is opt-in per project and encrypted end-to-end.',
  },
  {
    q: 'What inputs can Carbon ingest?',
    a: 'OpenAPI, Swagger, GraphQL schemas, Postman collections, HAR files, recorded live traffic, and — optionally — documentation and SDK sources.',
  },
  {
    q: 'Does it work with GraphQL?',
    a: 'Yes. The behavior graph is protocol-agnostic. Carbon speaks REST and GraphQL through the same underlying runtime.',
  },
  {
    q: 'Can I self-host?',
    a: 'The CLI and runtime are local by default. The Enterprise plan adds a self-hosted control plane for teams that require it.',
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Section id="faq" className="py-24">
      <SectionHeading
        eyebrow="FAQ"
        title="Questions, answered."
        align="center"
        className="mx-auto"
      />
      <div className="mx-auto mt-12 max-w-2xl overflow-hidden rounded-lg border border-border">
        {items.map((item, i) => {
          const expanded = open === i;
          return (
            <div key={item.q} className={i > 0 ? 'border-t border-border' : ''}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : i)}
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left text-sm font-medium transition-colors hover:bg-subtle"
              >
                <span>{item.q}</span>
                {expanded ? (
                  <Minus className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Plus className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              <div
                className={cn(
                  'grid overflow-hidden text-sm text-muted-foreground transition-[grid-template-rows] duration-200',
                  expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                )}
              >
                <div className="min-h-0">
                  <p className="px-6 pb-5 pt-0">{item.a}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
