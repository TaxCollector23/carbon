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
    <Section id="sdk">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr] lg:items-start">
        <SectionHeading
          title="Drive the runtime from a test file."
          description="Reset between tests. Snapshot between checkpoints. Assert on state."
        />
        <div className="border-border bg-subtle/40 overflow-hidden border">
          <div className="border-border text-muted-foreground flex items-center justify-between border-b px-4 py-3 text-xs">
            <span className="font-mono">tests/checkout.test.ts</span>
            <span className="text-2xs font-mono uppercase tracking-widest">typescript</span>
          </div>
          <pre className="overflow-x-auto px-5 py-5 font-mono text-[13px] leading-6">
            <code>{snippet}</code>
          </pre>
        </div>
      </div>
    </Section>
  );
}
