import { Camera, Database, Radio, Scale } from 'lucide-react';
import { Section, SectionHeading } from './section';

/**
 * Trimmed to the four capabilities that are genuinely differentiated versus
 * MSW / WireMock / Prism / Mockoon / Postman Mocks. Every other item in the
 * old grid (auth, pagination, streaming, GraphQL, resource graph) is real,
 * but they read as table-stakes on a landing page and dilute the pitch.
 */
const features = [
  {
    icon: Database,
    title: 'Persists state',
    body: 'Every POST, PUT, PATCH, and DELETE is stored. Later GETs return what you actually wrote — not a canned example.',
  },
  {
    icon: Camera,
    title: 'Freezes with snapshots',
    body: 'Freezes the whole server state to JSON, then restores it before each test in a millisecond. Rewind mid-run too.',
  },
  {
    icon: Scale,
    title: 'Forces failures (chaos)',
    body: 'One flag forces timeouts, 5xx, rate limits, or partial writes. Exercise the error paths you never test on staging.',
  },
  {
    icon: Radio,
    title: 'Records real traffic',
    body: 'Point Carbon at a real API in record mode, hit it once, and replay the traffic offline forever after.',
  },
];

export function Features() {
  return (
    <Section id="features" className="bg-subtle/50">
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
