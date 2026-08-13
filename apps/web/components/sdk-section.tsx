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
        <div className="border-border overflow-hidden border bg-[hsl(226_18%_14%)] shadow-[0_24px_70px_-45px_rgba(0,0,0,0.7)] transition-transform duration-300 hover:-translate-y-1">
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            </div>
            <span className="text-2xs font-mono uppercase tracking-widest text-white/40">
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
