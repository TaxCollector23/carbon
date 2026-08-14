import { Section, SectionHeading } from './section';

const problems = [
  {
    title: 'Your integration suite hits Stripe test mode and takes 4 minutes',
    body: 'Every CI run pays the round-trip tax to someone else’s sandbox. A flaky network turns a green build red.',
  },
  {
    title: 'A coworker’s migration corrupts the shared sandbox mid-run',
    body: 'One team seeds fixtures, another truncates them, and your PR fails on data that vanished ten minutes ago.',
  },
  {
    title: 'Your mock returns [] for a resource you just POSTed',
    body: 'Prism, WireMock, and hand-rolled fixtures reply with canned examples. They forget every write the moment it happens.',
  },
  {
    title: 'Offline means the tests don’t run',
    body: 'On a plane, on a train, or on a VPN that just dropped — a local unit test should not depend on a remote API being reachable.',
  },
];

export function Problem() {
  return (
    <Section id="problem" className="bg-subtle/50 ">
      <div className="grid gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
        <SectionHeading
          title="Every test that touches a real API is a test that can’t be trusted."
          description="Shared sandboxes drift, static fixtures forget state, and third-party latency turns a unit test into a coffee break."
        />
        <div className="divide-border border-border divide-y border-y">
          {problems.map((p, index) => (
            <div key={p.title} className="group grid gap-4 py-6 sm:grid-cols-[4rem_1fr]">
              <div className="text-muted-foreground group-hover:text-foreground font-mono text-sm transition-colors">
                {String(index + 1).padStart(2, '0')}
              </div>
              <div>
                <h3 className="text-lg font-medium tracking-tight">{p.title}</h3>
                <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">{p.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
