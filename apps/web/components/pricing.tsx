import { Check } from 'lucide-react';
import { cn } from '@carbon/ui/cn';
import { Section, SectionHeading } from './section';

const tiers = [
  {
    name: 'Developer',
    price: '$0',
    period: '',
    description: 'CLI, runtime, imports, and snapshots for one developer or one repo.',
    features: [
      'Unlimited local runtimes',
      'OpenAPI, AsyncAPI, protobuf, gRPC, HAR, Postman, GraphQL, and recorded traffic imports',
      'JSON snapshots for tests and review',
      'GitHub-based install and updates',
    ],
    highlighted: false,
  },
  {
    name: 'Team',
    price: '$29',
    period: '/ developer / month',
    description: 'Shared projects and snapshots for teams building against the same APIs.',
    features: [
      'Shared graphs, recordings, and snapshots',
      'Dashboard for projects, runs, and activity',
      'CI-friendly auth and project keys',
      'Team retention settings',
      'Email support',
    ],
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Talk to us',
    period: '',
    description: 'Deployment and governance controls for larger teams.',
    features: [
      'Self-hosted control plane',
      'SSO and SCIM',
      'Audit logs, retention controls',
      'Private storage configuration',
      'Support and onboarding plan',
    ],
    highlighted: false,
  },
];

export function Pricing() {
  return (
    <Section id="pricing" className="py-24">
      <SectionHeading
        title="Start with the runtime. Add team features when shared state matters."
        description="The CLI and runtime stay simple. Shared workspace features can sit behind the dashboard when your team needs them."
        align="center"
        className="mx-auto"
      />
      <div className="mx-auto mt-14 grid max-w-3xl gap-4">
        {tiers.map((tier) => (
          <section
            key={tier.name}
            className={cn(
              'border-border bg-background flex flex-col border-y p-6 sm:p-8',
              tier.highlighted && 'bg-subtle/60',
            )}
          >
            <div>
              <div className="flex items-center gap-3">
                <h3 className="text-base font-medium">{tier.name}</h3>
              </div>
              <div className="mt-5 flex flex-wrap items-baseline gap-1">
                <span className="text-3xl font-medium tracking-tight">{tier.price}</span>
                <span className="text-muted-foreground text-sm">{tier.period}</span>
              </div>
              <p className="text-muted-foreground mt-3 max-w-xs text-sm leading-6">
                {tier.description}
              </p>
            </div>
            <ul className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
              {tier.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <Check className="text-foreground mt-0.5 h-4 w-4" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Section>
  );
}
