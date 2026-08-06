import { AlertTriangle, CloudOff, Gauge, Timer } from 'lucide-react';
import { Section, SectionHeading } from './section';

const problems = [
  {
    icon: CloudOff,
    title: 'Staging is a liability',
    body:
      'Shared staging environments break constantly. Someone is always running a migration, seeding data, or catching an incident on it.',
  },
  {
    icon: Gauge,
    title: 'Rate limits stall development',
    body:
      'Every developer hitting a real API burns quota, triggers throttling, and makes local iteration painfully slow.',
  },
  {
    icon: Timer,
    title: 'Mocks lie',
    body:
      'Static JSON mocks drift from the real API. They pass tests that fail in production. They hide bugs until it is too late.',
  },
  {
    icon: AlertTriangle,
    title: 'You cannot code on a plane',
    body:
      'The moment you leave the office network, half your stack stops working. Local development should not require the internet.',
  },
];

export function Problem() {
  return (
    <Section id="problem" className="py-24">
      <SectionHeading
        eyebrow="The problem"
        title="Building against real APIs is broken."
        description="Every team invents the same workarounds: brittle mocks, private staging clusters, expensive test accounts, and the fragile scripts that hold them together."
      />
      <div className="mt-14 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
        {problems.map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex flex-col gap-3 bg-background p-6">
            <Icon className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-base font-medium tracking-tight">{title}</h3>
            <p className="text-sm text-muted-foreground">{body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
