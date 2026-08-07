'use client';

import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@carbon/ui/cn';
import { Section, SectionHeading } from './section';

const items = [
  {
    q: 'Is the runtime deterministic?',
    a: 'Yes. Once ingestion produces the behavior graph, request handling is pure code — no AI, no network, no randomness unless you enable it. Same input, same output.',
  },
  {
    q: 'How is this different from MSW or nock?',
    a: 'MSW/nock return the response you scripted. Carbon runs a state engine: POST /customers actually creates a customer; the next GET /customers/:id returns it; DELETE removes it. You do not write the responses.',
  },
  {
    q: 'Does Carbon call out to my API in production?',
    a: 'No. carbon record proxies traffic once so you can capture it. After that, the runtime is entirely local. The recording proxy runs on 127.0.0.1 and redacts auth headers by default.',
  },
  {
    q: 'What inputs work?',
    a: 'OpenAPI 3.x / Swagger 2.0, GraphQL SDL, Postman v2.1 collections, HAR files, and observed traffic via carbon record. gRPC and AsyncAPI are on the roadmap.',
  },
  {
    q: 'How well does it handle GraphQL?',
    a: 'The parser turns types into resources and query/mutation fields into endpoints. Subscriptions are recognized but the runtime does not yet stream them — v0.2.',
  },
  {
    q: 'Can I self-host?',
    a: 'The CLI and runtime are already local. The control plane (dashboard, cloud sync, shared snapshots) can be self-hosted on the Enterprise plan — one Postgres, one Redis, one Docker image.',
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
