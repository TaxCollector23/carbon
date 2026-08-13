'use client';

import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@carbon/ui/cn';
import { Section, SectionHeading } from './section';

const items = [
  {
    q: 'Is the runtime deterministic?',
    a: 'Yes. Once ingestion produces the behavior graph, request handling is code running against the state engine. AI is not used on the request path.',
  },
  {
    q: 'How is this different from MSW or nock?',
    a: 'MSW and nock are useful for scripted responses. Carbon adds a state engine, so POST /customers can change what the next GET returns.',
  },
  {
    q: 'Does Carbon call out to my API in production?',
    a: 'No. carbon record proxies traffic once so you can capture it. After that, the runtime is entirely local. The recording proxy runs on 127.0.0.1 and redacts auth headers by default.',
  },
  {
    q: 'What inputs work?',
    a: 'OpenAPI 3.x, Swagger 2.0, AsyncAPI, protobuf, gRPC service declarations, GraphQL SDL, Postman v2.1 collections, HAR files, and observed traffic via carbon record.',
  },
  {
    q: 'How well does it handle GraphQL?',
    a: 'The parser turns types into resources and query/mutation fields into endpoints. Subscriptions are recognized but the runtime does not yet stream them — v0.2.',
  },
  {
    q: 'Can I self-host?',
    a: 'The CLI and runtime run on your machine today. The control plane can be deployed with Postgres, Redis, and object storage when your team needs shared state.',
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Section id="faq">
      <SectionHeading title="Questions, answered." align="center" className="mx-auto" />
      <div className="border-border mx-auto mt-12 max-w-2xl border-y">
        {items.map((item, i) => {
          const expanded = open === i;
          return (
            <div key={item.q} className={i > 0 ? 'border-border border-t' : ''}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : i)}
                className="hover:text-muted-foreground focus-visible:ring-ring focus-visible:ring-offset-background flex w-full items-center justify-between gap-4 py-5 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-4"
              >
                <span>{item.q}</span>
                {expanded ? (
                  <Minus className="text-muted-foreground h-4 w-4" />
                ) : (
                  <Plus className="text-muted-foreground h-4 w-4" />
                )}
              </button>
              <div
                className={cn(
                  'text-muted-foreground grid overflow-hidden text-sm transition-[grid-template-rows] duration-200',
                  expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                )}
              >
                <div className="min-h-0">
                  <p className="pb-5 pt-0 leading-6">{item.a}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
