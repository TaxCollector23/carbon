import { Section, SectionHeading } from './section';

const snippet = `import { carbon } from '@carbon/sdk';

const replica = await carbon.emulate({
  from: 'https://api.stripe.com',
  port: 8787,
  snapshot: 'seeded-checkout',
});

process.env.STRIPE_API_BASE = replica.url;

// your app talks to Stripe as usual — locally, deterministically
await replica.state.reset();
await replica.snapshot.save('after-refund');
`;

export function SdkSection() {
  return (
    <Section id="sdk" className="py-24">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr] lg:items-start">
        <SectionHeading
          eyebrow="SDK"
          title="Drive the runtime from a test file."
          description="Reset between tests. Snapshot between checkpoints. Assert on state."
        />
        <div className="overflow-hidden rounded-lg border border-border bg-[hsl(220_15%_8%)]">
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
            </div>
            <span className="font-mono text-2xs uppercase tracking-widest text-white/40">
              tests/checkout.test.ts
            </span>
            <span className="h-2.5 w-2.5" />
          </div>
          <pre className="overflow-x-auto px-5 py-5 font-mono text-[13px] leading-6 text-white/85">
            <code>{snippet}</code>
          </pre>
        </div>
      </div>
    </Section>
  );
}
