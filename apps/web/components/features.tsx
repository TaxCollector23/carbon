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
    body: 'Persists every POST, PUT, PATCH, and DELETE in memory. GETs return what you actually wrote.',
  },
  {
    icon: Waypoints,
    title: 'Resource graph',
    body: 'Tracks relationships between resources so a deleted parent cascades to its children.',
  },
  {
    icon: Camera,
    title: 'Snapshots',
    body: 'Freezes the whole server state to JSON. Restores it before each test in a millisecond.',
  },
  {
    icon: Webhook,
    title: 'Webhook simulation',
    body: 'Fires outbound webhooks on the mutations you configure. Inspects deliveries and retries.',
  },
  {
    icon: Clock,
    title: 'Latency injection',
    body: 'Replays p50 and p95 latency profiles so slow-network regressions surface in local runs.',
  },
  {
    icon: Scale,
    title: 'Chaos presets',
    body: 'Forces any status code, timeout, or partial failure on demand. Tests your error paths.',
  },
  {
    icon: KeyRound,
    title: 'Auth-aware',
    body: 'Checks API keys, OAuth scopes, and RBAC exactly like the upstream service does.',
  },
  {
    icon: Radio,
    title: 'Streaming & SSE',
    body: 'Serves long-lived responses and event streams the same way your production API does.',
  },
  {
    icon: Layers,
    title: 'Pagination',
    body: 'Replays cursor and offset pagination deterministically across snapshots.',
  },
  {
    icon: Cable,
    title: 'GraphQL & REST',
    body: 'Runs both from the same graph. Query, mutation, or endpoint — same primitives underneath.',
  },
];

export function Features() {
  return (
    <Section id="features" className="bg-subtle/50 ">
      <div className="grid gap-12 lg:grid-cols-[0.72fr_1.28fr]">
        <SectionHeading
          title="Everything a real backend does. None of the network."
          description="Mutate resources, force failures, replay latency, and inspect webhook deliveries — all against a server running on your laptop."
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
