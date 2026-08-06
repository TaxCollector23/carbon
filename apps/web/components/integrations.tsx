import { Section, SectionHeading } from './section';

const integrations = [
  'Stripe',
  'Twilio',
  'Slack',
  'GitHub',
  'Linear',
  'Shopify',
  'SendGrid',
  'Plaid',
  'Notion',
  'HubSpot',
  'PostHog',
  'Segment',
  'AWS',
  'Datadog',
  'Airtable',
  'Auth0',
  'Clerk',
  'Vercel',
];

export function Integrations() {
  return (
    <Section id="integrations" className="py-24">
      <SectionHeading
        eyebrow="Integrations"
        title="Works with the APIs you already integrate."
        description="Any API with a spec, a HAR file, or observable traffic is fair game. These are ready out of the box."
      />
      <div className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 md:grid-cols-6">
        {integrations.map((name) => (
          <div
            key={name}
            className="flex h-20 items-center justify-center bg-background text-sm text-muted-foreground transition-colors hover:bg-subtle hover:text-foreground"
          >
            {name}
          </div>
        ))}
      </div>
    </Section>
  );
}
