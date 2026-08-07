import { Section, SectionHeading } from './section';

const problems = [
  {
    title: 'Shared staging breaks',
    body: 'Somebody is always migrating, seeding, or debugging. Your feature branch is downstream of theirs.',
  },
  {
    title: 'Mocks drift',
    body: 'A JSON fixture written six months ago passes tests the real API would fail. You find out in prod.',
  },
  {
    title: 'Rate limits gate iteration',
    body: 'Stripe test mode is 100 req/s. Your integration test suite wants 400. You wait, or you skip.',
  },
  {
    title: 'Offline is broken',
    body: 'You lose Wi-Fi and half your stack goes down with it. Local development shouldn\'t depend on the internet.',
  },
];

export function Problem() {
  return (
    <Section id="problem" className="py-24">
      <SectionHeading
        eyebrow="Problem"
        title="Building against third-party APIs is a tax on every feature."
      />
      <div className="mt-14 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
        {problems.map((p) => (
          <div key={p.title} className="flex flex-col gap-2 bg-background p-8">
            <h3 className="text-base font-medium tracking-tight">{p.title}</h3>
            <p className="text-sm text-muted-foreground">{p.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
