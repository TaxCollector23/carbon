import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { buttonVariants, cn } from '@carbon/ui';
import { Nav } from '@/components/nav';
import { Footer } from '@/components/footer';
import { Section, SectionHeading } from '@/components/section';

export const metadata: Metadata = {
  title: 'Enterprise API emulation — Carbon',
  description:
    'Self-hosted stateful API replicas, SSO, SCIM, audit export, and measurable pilot outcomes for engineering teams.',
};

const evaluationMetrics = [
  ['Upstream calls removed', 'Measure third-party sandbox calls before and after Carbon in CI.'],
  ['Flake rate reduction', 'Track integration-test retries and non-code failures over two weeks.'],
  ['p95 test latency', 'Compare selected workflows against the current sandbox-backed suite.'],
  ['Snapshot restore time', 'Verify seeded environments reset in milliseconds instead of minutes.'],
  [
    'Coverage migrated',
    'Count workflows moved from static fixtures or shared sandboxes to Carbon.',
  ],
];

const targetTeams = [
  'Teams with slow or flaky third-party integration tests',
  'Platforms that maintain shared Stripe, GitHub, Slack, Twilio, or internal API sandboxes',
  'Regulated engineering orgs that need deterministic test environments and audit export',
  'Developer-experience teams trying to standardize API mocks across many repos',
];

export default function EnterprisePage() {
  return (
    <div className="bg-background text-foreground min-h-dvh">
      <Nav />
      <main id="main" className="pt-16">
        <Section id="enterprise-hero" bordered={false}>
          <div className="max-w-3xl py-8">
            <h1 className="text-balance text-5xl font-medium tracking-tight sm:text-6xl">
              Enterprise replicas for APIs your teams cannot afford to mock badly.
            </h1>
            <p className="text-muted-foreground mt-6 max-w-2xl text-lg leading-8">
              Carbon gives platform and QA teams a repeatable way to replace shared sandboxes with
              stateful local runtimes, governed cloud projects, audit history, SSO, SCIM, and
              optional self-hosting.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/contact" className={cn(buttonVariants({ size: 'lg' }), 'gap-2')}>
                Plan a pilot
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/benchmarks"
                className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }))}
              >
                View benchmarks
              </Link>
            </div>
          </div>
        </Section>

        <Section id="who">
          <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
            <SectionHeading
              title="Start with teams that already feel the sandbox tax."
              description="The best early enterprise customers have measurable pain before the first call: slow builds, brittle upstream test accounts, compliance review around test data, or many repos duplicating fixture work."
            />
            <div className="border-border divide-border divide-y border-y">
              {targetTeams.map((team, index) => (
                <div key={team} className="grid gap-4 py-5 sm:grid-cols-[4rem_1fr]">
                  <span className="text-muted-foreground font-mono text-sm">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <p className="text-sm leading-6">{team}</p>
                </div>
              ))}
            </div>
          </div>
        </Section>

        <Section id="pilot">
          <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
            <SectionHeading
              title="A pilot should prove operational value in two weeks."
              description="Pick one integration-heavy workflow, capture or import the contract, run it in CI, and compare the new run against the baseline the team already tracks."
            />
            <div className="border-border overflow-x-auto border-y">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border text-muted-foreground border-b text-left">
                    <th className="px-4 py-3 font-medium">Metric</th>
                    <th className="px-4 py-3 font-medium">How to measure</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluationMetrics.map(([metric, method]) => (
                    <tr key={metric} className="border-border border-b last:border-b-0">
                      <td className="px-4 py-3 font-medium">{metric}</td>
                      <td className="text-muted-foreground px-4 py-3">{method}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>

        <Section id="deployment">
          <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
            <SectionHeading
              title="Recommended deployment"
              description="For the current codebase, keep the dashboard and marketing on Vercel. Run the API and worker as long-running services when you need hosted async ingestion, with Postgres for durable data and Upstash Redis for queue/job state."
            />
            <div className="border-border divide-border divide-y border-y text-sm">
              <div className="py-5">
                <h3 className="font-medium">Zero-cost demo path</h3>
                <p className="text-muted-foreground mt-2 leading-6">
                  Vercel for web and dashboard, local API for demos, Upstash Redis free tier for
                  async queues, and Neon free tier for Postgres when you connect the backend.
                </p>
              </div>
              <div className="py-5">
                <h3 className="font-medium">Production path</h3>
                <p className="text-muted-foreground mt-2 leading-6">
                  Keep Vercel for the Next.js apps, then deploy the Fastify API and worker to a
                  service that supports long-running processes. Use `CARBON_PUBLIC_API_URL` only
                  after that host exists.
                </p>
              </div>
            </div>
          </div>
        </Section>
      </main>
      <Footer />
    </div>
  );
}
