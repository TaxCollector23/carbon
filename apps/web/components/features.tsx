import {
  Cable,
  Camera,
  Clock,
  Database,
  KeyRound,
  Layers,
  Radio,
  Scale,
  Waypoints,
  Webhook,
} from 'lucide-react';
import { Section, SectionHeading } from './section';

const features = [
  {
    icon: Database,
    title: 'Stateful CRUD',
    body: 'Reads reflect writes through the state engine.',
  },
  {
    icon: Waypoints,
    title: 'Resource graph',
    body: 'Relationships modeled explicitly across resources.',
  },
  {
    icon: Camera,
    title: 'Snapshots',
    body: 'Save full state, branch it, restore it, and compare it.',
  },
  {
    icon: Webhook,
    title: 'Webhook simulation',
    body: 'Trigger and inspect outbound webhook deliveries.',
  },
  {
    icon: Clock,
    title: 'Latency simulation',
    body: 'Model realistic p50 / p95 to catch UX regressions.',
  },
  {
    icon: Scale,
    title: 'Error injection',
    body: 'Force any status code, timeout, or partial failure.',
  },
  {
    icon: KeyRound,
    title: 'Auth-aware',
    body: 'API keys, OAuth flows, and RBAC modeled correctly.',
  },
  {
    icon: Radio,
    title: 'Streaming & SSE',
    body: 'Long-lived responses and event streams supported.',
  },
  {
    icon: Layers,
    title: 'Pagination',
    body: 'Cursor and offset pagination replayed deterministically.',
  },
  {
    icon: Cable,
    title: 'GraphQL & REST',
    body: 'One runtime for both. Same graph, same primitives.',
  },
];

export function Features() {
  return (
    <Section id="features" className="bg-subtle/50 ">
      <div className="grid gap-12 lg:grid-cols-[0.72fr_1.28fr]">
        <SectionHeading
          title="Backend behavior without the upstream dependency."
          description="Use only what the test needs: mutate resources, force failures, replay latency, and inspect delivery state."
        />
        <div className="border-border grid gap-x-8 border-y py-4 sm:grid-cols-2">
          {features.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="border-border group grid grid-cols-[1.5rem_1fr] gap-4 border-b py-5 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0"
            >
              <Icon className="text-muted-foreground group-hover:text-foreground mt-0.5 h-4 w-4 transition-colors" />
              <div>
                <h3 className="text-sm font-medium">{title}</h3>
                <p className="text-muted-foreground mt-1 text-sm leading-6">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
