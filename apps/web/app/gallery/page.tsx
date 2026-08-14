import type { Metadata } from 'next';
import Link from 'next/link';
import { Nav } from '@/components/nav';
import { Footer } from '@/components/footer';
import { Section, SectionHeading } from '@/components/section';
import { dashboardUrl } from '@/lib/urls';

export const metadata: Metadata = {
  title: 'Public Gallery — curated APIs ready to emulate',
  description:
    'One-click launch of a stateful Carbon replica for common APIs like Stripe, GitHub, and Shopify.',
};

interface GalleryEntry {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly specUrl: string;
  readonly tag: string;
}

// Curated static list — swap for a CMS or DB-backed feed once we have >20
// entries. Each spec is a public OpenAPI / GraphQL / gRPC document.
const ENTRIES: readonly GalleryEntry[] = [
  {
    slug: 'stripe',
    name: 'Stripe',
    description: 'Payments API — customers, charges, subscriptions, webhooks.',
    specUrl: 'https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json',
    tag: 'Payments',
  },
  {
    slug: 'github',
    name: 'GitHub',
    description: 'REST v3 — repos, issues, pulls, actions, users.',
    specUrl:
      'https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json',
    tag: 'DevTools',
  },
  {
    slug: 'shopify',
    name: 'Shopify Admin',
    description: 'Shop management — products, orders, customers, fulfillment.',
    specUrl: 'https://shopify.dev/admin-rest-api/2024-01/openapi.json',
    tag: 'Commerce',
  },
  {
    slug: 'openai',
    name: 'OpenAI',
    description: 'Chat completions, embeddings, files, assistants.',
    specUrl: 'https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml',
    tag: 'AI',
  },
  {
    slug: 'twilio',
    name: 'Twilio Messaging',
    description: 'SMS, MMS, WhatsApp — messages, media, opt-outs.',
    specUrl:
      'https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/json/twilio_api_v2010.json',
    tag: 'Communications',
  },
  {
    slug: 'slack',
    name: 'Slack Web API',
    description: 'Conversations, users, files, reactions — full Web API surface.',
    specUrl:
      'https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json',
    tag: 'Collaboration',
  },
];

// Curated sample IDs served by `GET /v1/samples` — a click on one of these
// deep-links into the dashboard, which auto-instantiates the sample into a
// fresh project via `POST /v1/samples/instantiate` (see apps/api/src/routes/
// samples.ts). Entries not in this set fall back to the legacy /projects/new
// prefill flow so gallery items without a bundled fixture still work.
const BUNDLED_SAMPLE_IDS: ReadonlySet<string> = new Set([
  'petstore',
  'stripe',
  'github',
  'shopify',
  'openai',
  'twilio',
]);

function openInCarbon(entry: GalleryEntry): string {
  const base = dashboardUrl();
  if (BUNDLED_SAMPLE_IDS.has(entry.slug)) {
    return `${base}/?sample=${encodeURIComponent(entry.slug)}`;
  }
  const params = new URLSearchParams({ spec: entry.specUrl, name: entry.name });
  return `${base}/projects/new?${params.toString()}`;
}

export default function GalleryPage() {
  return (
    <div className="bg-background text-foreground min-h-dvh">
      <Nav />
      <main id="main" className="pt-16">
        <Section id="gallery" className="py-24">
          <SectionHeading
            title="Public gallery"
            description="Curated APIs ready to spin up as a stateful replica in seconds. Zero setup — no key required."
            align="center"
          />
          <ul className="mx-auto mt-16 grid w-full max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {ENTRIES.map((entry) => (
              <li
                key={entry.slug}
                className="border-border bg-background/40 hover:bg-background/70 flex flex-col justify-between rounded-lg border p-6 transition"
              >
                <div>
                  <div className="text-muted-foreground text-xs uppercase tracking-wider">
                    {entry.tag}
                  </div>
                  <h3 className="mt-2 text-lg font-semibold">{entry.name}</h3>
                  <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                    {entry.description}
                  </p>
                </div>
                <div className="mt-6 flex items-center gap-3">
                  <Link
                    href={openInCarbon(entry)}
                    className="bg-foreground text-background rounded-md px-3 py-2 text-sm font-medium hover:opacity-90"
                  >
                    Open in Carbon
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      </main>
      <Footer />
    </div>
  );
}

export const galleryEntries = ENTRIES;
