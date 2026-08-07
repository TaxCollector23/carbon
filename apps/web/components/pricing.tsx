import Link from 'next/link';
import { Check } from 'lucide-react';
import { buttonVariants, cn } from '@carbon/ui';
import { Section, SectionHeading } from './section';

const tiers = [
  {
    name: 'Local',
    price: '$0',
    period: '/ forever',
    description: 'The full runtime and CLI. Runs on your machine.',
    features: [
      'Unlimited emulators, unlimited requests',
      'All parser formats (OpenAPI, HAR, Postman, GraphQL)',
      'Snapshots saved locally',
      'MIT-licensed CLI',
    ],
    cta: { label: 'Install the CLI', href: '/docs/installation' },
    highlighted: false,
  },
  {
    name: 'Team',
    price: '$29',
    period: '/ developer / month',
    description: 'Cloud sync, shared graphs, CI runners, dashboard.',
    features: [
      'Cloud-synced snapshots and graphs',
      'Shared behavior across your org',
      'Hosted CI runners for emulators',
      'Web dashboard',
      'Email support, one-day SLA',
    ],
    cta: { label: 'Start 14-day trial', href: '/get-started?plan=team' },
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Talk to us',
    period: '',
    description: 'Self-hosted control plane, SSO, audit logs, custom SLA.',
    features: [
      'Self-hosted control plane',
      'SSO (Okta, Azure AD, Google Workspace)',
      'SCIM provisioning',
      'Audit logs, retention controls',
      'Named support engineer',
    ],
    cta: { label: 'Contact sales', href: '/contact' },
    highlighted: false,
  },
];

export function Pricing() {
  return (
    <Section id="pricing" className="py-24">
      <SectionHeading
        eyebrow="Pricing"
        title="The runtime is free."
        description="You pay when you want cloud sync and shared state across your team."
        align="center"
        className="mx-auto"
      />
      <div className="mx-auto mt-14 grid max-w-5xl gap-6 md:grid-cols-3">
        {tiers.map((tier) => (
          <div
            key={tier.name}
            className={cn(
              'flex flex-col rounded-lg border bg-card p-8',
              tier.highlighted ? 'border-foreground shadow-sm' : 'border-border',
            )}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-medium">{tier.name}</h3>
              {tier.highlighted ? (
                <span className="rounded-full border border-border px-2 py-0.5 text-2xs uppercase tracking-widest text-muted-foreground">
                  Most teams
                </span>
              ) : null}
            </div>
            <div className="mt-5 flex items-baseline gap-1">
              <span className="text-3xl font-medium tracking-tight">{tier.price}</span>
              <span className="text-sm text-muted-foreground">{tier.period}</span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{tier.description}</p>
            <ul className="mt-6 flex flex-col gap-3 text-sm">
              {tier.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 h-4 w-4 text-foreground" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href={tier.cta.href}
              className={cn(
                'mt-8',
                buttonVariants({ variant: tier.highlighted ? 'primary' : 'secondary' }),
              )}
            >
              {tier.cta.label}
            </Link>
          </div>
        ))}
      </div>
    </Section>
  );
}
