import { Boxes, Fingerprint, GitBranch, ShieldCheck } from 'lucide-react';
import { Section, SectionHeading } from './section';

const pillars = [
  {
    icon: Boxes,
    title: 'Behavioral, not static',
    body:
      'Carbon models the API as a state machine — resources, relationships, transitions, lifecycles. Not JSON files.',
  },
  {
    icon: Fingerprint,
    title: 'Deterministic runtime',
    body:
      'Once ingested, the emulator is pure and repeatable. No AI in the request path. Same input, same output, every time.',
  },
  {
    icon: GitBranch,
    title: 'Composable and versioned',
    body:
      'Snapshot state, branch it, share it. Carbon replicas travel with your code, your tests, and your CI.',
  },
  {
    icon: ShieldCheck,
    title: 'Local by default',
    body:
      'The runtime is a single binary you control. No egress. No third-party data path. Enterprise-friendly from day one.',
  },
];

export function Solution() {
  return (
    <Section id="solution" className="py-24">
      <SectionHeading
        eyebrow="The solution"
        title="An API compiler for local development."
        description="Point Carbon at any input — OpenAPI, HAR, live traffic, docs — and it produces a deterministic local emulator that behaves like production."
      />
      <div className="mt-14 grid gap-6 lg:grid-cols-2">
        {pillars.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="rounded-lg border border-border bg-card p-8 transition-colors hover:bg-subtle"
          >
            <Icon className="h-5 w-5 text-foreground" />
            <h3 className="mt-5 text-lg font-medium tracking-tight">{title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
