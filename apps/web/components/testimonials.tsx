import { Section, SectionHeading } from './section';

const quotes = [
  {
    body: 'We deleted an entire staging environment the week we adopted Carbon. Our CI got 6× faster and stopped flaking.',
    author: 'Head of Platform',
    company: 'Fintech · Series B',
  },
  {
    body: 'It caught a pagination bug that had been in production for a year. The state engine tripped on it in about a minute.',
    author: 'Staff Engineer',
    company: 'Marketplace · Series C',
  },
  {
    body: 'I can finally write integration tests I trust. Snapshots make the whole thing reproducible.',
    author: 'Founding Engineer',
    company: 'Seed-stage SaaS',
  },
];

export function Testimonials() {
  return (
    <Section id="testimonials" className="py-24">
      <SectionHeading
        eyebrow="Trusted by engineers"
        title="Built for teams that ship."
      />
      <div className="mt-14 grid gap-6 md:grid-cols-3">
        {quotes.map((q) => (
          <figure
            key={q.author}
            className="flex h-full flex-col justify-between gap-6 rounded-lg border border-border bg-card p-8"
          >
            <blockquote className="text-base leading-relaxed text-foreground">
              &ldquo;{q.body}&rdquo;
            </blockquote>
            <figcaption className="text-sm">
              <div className="font-medium">{q.author}</div>
              <div className="text-muted-foreground">{q.company}</div>
            </figcaption>
          </figure>
        ))}
      </div>
    </Section>
  );
}
