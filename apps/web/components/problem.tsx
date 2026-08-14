import { Section, SectionHeading } from './section';

const problems = [
  {
    title: 'Your integration suite hits Stripe test mode and takes 4 minutes',
    body: 'Every CI run waits on someone else’s sandbox. Network variance turns ordinary integration coverage into slow feedback.',
  },
  {
    title: 'A coworker’s migration corrupts the shared sandbox mid-run',
    body: 'One team seeds fixtures, another resets them, and your PR depends on shared state nobody meant to change.',
  },
  {
    title: 'Your mock returns [] for a resource you just POSTed',
    body: 'Static examples are useful for smoke tests, but they do not model read-after-write flows or destructive updates.',
  },
  {
    title: 'Offline means the tests don’t run',
    body: 'A local test suite should not depend on a remote API being reachable before developers can ship.',
  },
];

export function Problem() {
  return (
    <Section id="problem" className="bg-subtle/50">
      <div className="grid gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
        <SectionHeading
          title="Integration tests should be fast without becoming shallow."
          description="Shared sandboxes drift, static fixtures lose state, and third-party latency slows feedback right when teams need confidence."
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
