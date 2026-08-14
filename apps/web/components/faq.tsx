'use client';

import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@carbon/ui/cn';
import { Section, SectionHeading } from './section';

interface FaqGroup {
  readonly heading: string;
  readonly items: readonly { q: string; a: string }[];
}

const groups: readonly FaqGroup[] = [
  {
    heading: 'Basics',
    items: [
      {
        q: 'What actually is Carbon?',
        a: 'A CLI + runtime that turns any API spec (OpenAPI, GraphQL SDL, Postman, HAR, protobuf, AsyncAPI) into a stateful local replica you can develop and test against. If you POST /customers to Carbon, the next GET /customers/:id returns what you just created — it is not a canned mock.',
      },
      {
        q: 'How is this different from MSW, nock, or WireMock?',
        a: 'Those tools return scripted responses. Carbon runs a real state engine, so writes affect reads, relationships between resources are enforced, and snapshots freeze a whole scenario for reuse across a test suite or a whole team.',
      },
      {
        q: 'Is the runtime deterministic?',
        a: 'Yes. Once ingestion produces the behavior graph, request handling is pure code against the state engine — no AI or network on the request path.',
      },
      {
        q: 'What inputs work?',
        a: 'OpenAPI 3.x, Swagger 2.0, AsyncAPI, protobuf, gRPC service declarations, GraphQL SDL, Postman v2.1 collections, HAR files, and observed traffic captured via `carbon record`.',
      },
    ],
  },
  {
    heading: 'Local development',
    items: [
      {
        q: 'Do I need an account to use Carbon locally?',
        a: 'No. Everything the CLI does locally — `init`, `ingest`, `emulate`, `snapshot`, `record`, `replay` — works with zero credentials. An account only matters when you want cloud snapshot sync, dashboard, team roles, or the audit log.',
      },
      {
        q: 'Does Carbon phone home in production?',
        a: 'No. `carbon record` proxies traffic once to capture it (on 127.0.0.1, with auth headers redacted by default). After that the runtime is entirely local. Opt-in anonymous telemetry (`CARBON_TELEMETRY=1`) records command name + success only.',
      },
      {
        q: "The emulator hangs sometimes — what's up?",
        a: 'Round 18 fixed the two common causes: a port-in-use crash that printed nothing, and a Fastify boot pause that looked like a freeze. `carbon emulate` now preflights the port, prints a `Starting emulator…` line immediately, and hard-times-out at 20s with a friendly error.',
      },
    ],
  },
  {
    heading: 'Teams & cloud',
    items: [
      {
        q: 'How does the CLI login work?',
        a: 'Device-code flow, exactly like `gh auth login`. `carbon login` opens the dashboard at `/cli-auth/<sessionId>` in your browser; you sign in with Better Auth (email/password or SSO for enterprise), approve the CLI, and the poll picks up the minted API key. The whole thing takes about 30 seconds.',
      },
      {
        q: 'Do I have to use the cloud dashboard?',
        a: 'No. Self-host it with `docker compose -f docker-compose.selfhost.yml up` — bundles Postgres, Redis, api, dashboard, and a one-shot migrate sidecar. You keep everything on your own infra.',
      },
      {
        q: 'How does SSO / SAML work?',
        a: "OIDC is live today via the sign-in page's email-domain match. SAML is captured in the SSO provider CRUD but the sign-in shim currently 501s for SAML — the full SAML flow lands when the Better Auth SSO plugin ships.",
      },
    ],
  },
  {
    heading: 'Under the hood',
    items: [
      {
        q: 'How well does it handle GraphQL?',
        a: "The parser turns SDL types into resources and Query/Mutation fields into endpoints. It also emits REST shims at `/rest/<plural>` so GraphQL and REST clients share the same state. Subscriptions are recognized but not yet streamed — that's on the roadmap.",
      },
      {
        q: 'What about WebSockets and SSE?',
        a: "The emulator exposes `/__carbon/state/stream` as a WebSocket for live mutation frames — the dashboard's State section renders this in real time, and the `carbon watch` CLI tails it. The control-plane audit feed also streams over SSE at `/v1/events/stream`.",
      },
      {
        q: 'Where is state stored?',
        a: 'The runtime engine is in-memory by default. `carbon snapshot save/load` freezes and restores it to disk (local) or the cloud (with an account). A mutation journal lets you `rewind` / `forward` through history without a full restore.',
      },
    ],
  },
];

export function Faq() {
  // Compose a flat list up front so the accordion index is stable across
  // groups. The heading rows are rendered inline based on group boundaries.
  const flat = groups.flatMap((g, gi) =>
    g.items.map((item, ii) => ({ ...item, group: g.heading, first: ii === 0, gi })),
  );
  const [open, setOpen] = useState<number | null>(0);

  return (
    <Section id="faq">
      <SectionHeading
        title="Questions, answered."
        description="Everything a first-time user tends to ask — grouped by scope so you can skim the parts that matter for you."
        align="center"
        className="mx-auto"
      />
      <div className="mx-auto mt-12 max-w-3xl">
        {flat.map((item, i) => {
          const expanded = open === i;
          return (
            <div key={`${item.gi}-${item.q}`}>
              {item.first ? (
                <div
                  className={cn(
                    'text-muted-foreground pb-2 pt-8 text-xs font-medium uppercase tracking-widest',
                    i === 0 && 'pt-0',
                  )}
                >
                  {item.group}
                </div>
              ) : null}
              <div className="border-border border-t first-of-type:border-t-0">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : i)}
                  className="hover:text-muted-foreground focus-visible:ring-ring focus-visible:ring-offset-background flex w-full items-center justify-between gap-4 py-5 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-4"
                >
                  <span>{item.q}</span>
                  {expanded ? (
                    <Minus className="text-muted-foreground h-4 w-4 shrink-0" />
                  ) : (
                    <Plus className="text-muted-foreground h-4 w-4 shrink-0" />
                  )}
                </button>
                <div
                  className={cn(
                    'text-muted-foreground grid overflow-hidden text-sm transition-[grid-template-rows] duration-200',
                    expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                  )}
                >
                  <div className="min-h-0">
                    <p className="max-w-prose pb-5 pt-0 leading-7">{item.a}</p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
