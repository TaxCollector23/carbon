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
  { icon: Database, title: 'Stateful CRUD', body: 'Real reads reflect real writes. Not fixtures.' },
  { icon: Waypoints, title: 'Resource graph', body: 'Relationships modeled explicitly across resources.' },
  { icon: Camera, title: 'Snapshots', body: 'Freeze the full state. Branch. Restore. Diff.' },
  { icon: Webhook, title: 'Webhook simulation', body: 'Trigger and inspect outbound webhook deliveries.' },
  { icon: Clock, title: 'Latency simulation', body: 'Model realistic p50 / p95 to catch UX regressions.' },
  { icon: Scale, title: 'Error injection', body: 'Force any status code, timeout, or partial failure.' },
  { icon: KeyRound, title: 'Auth-aware', body: 'API keys, OAuth flows, and RBAC modeled correctly.' },
  { icon: Radio, title: 'Streaming & SSE', body: 'Long-lived responses and event streams supported.' },
  { icon: Layers, title: 'Pagination', body: 'Cursor and offset pagination replayed deterministically.' },
  { icon: Cable, title: 'GraphQL & REST', body: 'One runtime for both. Same graph, same primitives.' },
];

export function Features() {
  return (
    <Section id="features" className="py-24">
      <SectionHeading
        eyebrow="Features"
        title="Everything a real backend does."
        description="Carbon is not a mock. It is a runtime. Every feature you would expect from a production API is available locally."
      />
      <div className="mt-14 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {features.map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex flex-col gap-2 bg-background p-6">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">{title}</h3>
            <p className="text-sm text-muted-foreground">{body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
