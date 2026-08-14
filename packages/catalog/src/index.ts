import type { CatalogCategory, CatalogEntry } from './types.js';
import { stripe } from './entries/stripe.js';
import { github } from './entries/github.js';
import { openai } from './entries/openai.js';
import { slack } from './entries/slack.js';
import { twilio } from './entries/twilio.js';
import { notion } from './entries/notion.js';
import { linear } from './entries/linear.js';
import { shopify } from './entries/shopify.js';

export type { CatalogEntry, CatalogCategory, CatalogSpecFormat } from './types.js';

/**
 * The canonical list of emulator catalog entries. Order controls display
 * order on the /emulators index page — group by category first, then
 * alphabetise inside a category.
 */
export const CATALOG: readonly CatalogEntry[] = [
  stripe,
  github,
  openai,
  slack,
  twilio,
  notion,
  linear,
  shopify,
];

const BY_SLUG: ReadonlyMap<string, CatalogEntry> = new Map(
  CATALOG.map((entry) => [entry.slug, entry]),
);

export function findEntry(slug: string): CatalogEntry | undefined {
  return BY_SLUG.get(slug);
}

export const CATEGORY_LABELS: Readonly<Record<CatalogCategory, string>> = {
  payments: 'Payments',
  auth: 'Auth',
  communication: 'Communication',
  ai: 'AI',
  'dev-platform': 'Developer platforms',
  storage: 'Storage',
  other: 'Other',
};

/**
 * Return the catalog grouped by category, preserving in-category order.
 * Categories with zero entries are omitted.
 */
export function catalogByCategory(): ReadonlyArray<{
  category: CatalogCategory;
  label: string;
  entries: readonly CatalogEntry[];
}> {
  const buckets = new Map<CatalogCategory, CatalogEntry[]>();
  for (const entry of CATALOG) {
    const bucket = buckets.get(entry.category);
    if (bucket) {
      bucket.push(entry);
    } else {
      buckets.set(entry.category, [entry]);
    }
  }
  return Array.from(buckets.entries()).map(([category, entries]) => ({
    category,
    label: CATEGORY_LABELS[category],
    entries,
  }));
}
