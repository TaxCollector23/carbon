import { Section, SectionHeading } from './section';

const problems = [
  {
    title: 'Shared staging changes underneath you',
    body: 'Test data, migrations, and service state can shift before your branch is ready.',
  },
  {
    title: 'Fixtures drift from real behavior',
    body: 'Static JSON keeps tests moving, but it rarely captures state changes and relationships.',
  },
  {
    title: 'Third-party limits slow test runs',
    body: 'External quotas and network latency turn ordinary integration tests into waiting time.',
  },
  {
    title: 'Network access becomes a hidden dependency',
    body: 'A local test should not fail because a remote API, VPN, or sandbox is unavailable.',
  },
];

export function Problem() {
  return (
    <Section id="problem" className="bg-subtle/50 py-24">
      <div className="grid gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
        <SectionHeading
          title="API development slows down when every test depends on someone else’s system."
          description="Shared staging, stale fixtures, third-party limits, and network access all add friction before your code can prove it works."
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
