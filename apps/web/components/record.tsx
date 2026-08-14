import { Section, SectionHeading } from './section';

/**
 * The `carbon record` wedge. This is the sharper differentiator vs Prism /
 * WireMock (which need hand-written stubs) and vs MSW (in-process fakes).
 * Point Carbon at your prod API, let it observe for an afternoon, and you
 * walk away with an emulator that behaves like the real integration —
 * including the edge cases the OpenAPI spec forgets to mention.
 */
const highlights = [
  {
    title: 'Records what actually happened',
    body: 'A local HTTP proxy captures every request + response, redacts auth headers by default, and writes an atomic recording you can commit.',
  },
  {
    title: 'Infers the real resource model',
    body: 'Carbon derives resources, relationships, and pagination shape from observed traffic, including cases the written spec does not cover.',
  },
  {
    title: 'Boots deterministically from the capture',
    body: 'One `carbon emulate --from` and you have a stateful replica that answers in microseconds, offline, forever.',
  },
];

export function Record() {
  return (
    <Section id="record">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:items-start">
        <div>
          <SectionHeading
            title="Or point Carbon at your prod API for an afternoon."
            description="It records real requests + responses, infers the resource model from observed behavior, and produces an emulator that covers the edge cases your team already hits."
          />
          <div className="border-border mt-10 border-y">
            {highlights.map((h) => (
              <div key={h.title} className="border-border border-b py-5 last:border-b-0">
                <h3 className="text-base font-medium tracking-tight">{h.title}</h3>
                <p className="text-muted-foreground mt-2 text-sm leading-6">{h.body}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="border-border border">
          <div className="border-border text-2xs text-muted-foreground border-b px-5 py-3 font-mono uppercase tracking-widest">
            record → emulate
          </div>
          <pre className="text-foreground overflow-x-auto p-6 font-mono text-sm leading-6">
            {`# 1. Point Carbon at your upstream. Traffic flows through
#    a local proxy; requests + responses are captured.
carbon record --target https://api.stripe.com \\
              --out ./stripe-capture

# ...go build the integration, exercise the edge cases...

# 2. Turn the capture into a deterministic local emulator.
carbon emulate --from ./stripe-capture

# Same URL, in your laptop and in CI. No spec required.
# Auth headers redacted by default — safe to commit.`}
          </pre>
        </div>
      </div>
    </Section>
  );
}
