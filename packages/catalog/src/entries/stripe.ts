import type { CatalogEntry } from '../types.js';

export const stripe: CatalogEntry = {
  slug: 'stripe',
  name: 'Stripe',
  tagline: 'Payments API',
  category: 'payments',
  logo: 'S',
  specUrl: 'https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json',
  specFormat: 'openapi',
  homepage: 'https://stripe.com',
  quickstart: 'npx carbon-dev emulate --catalog stripe',
  seedResources: ['customers', 'charges', 'subscriptions', 'invoices'],
  description:
    'Boot a stateful mock of the Stripe API in one command. Create customers, charges, and subscriptions; Carbon persists them across requests so integration tests behave like the real thing without hitting Stripe.',
};
