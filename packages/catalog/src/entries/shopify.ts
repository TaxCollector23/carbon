import type { CatalogEntry } from '../types.js';

// TODO: verify spec url — Shopify's Admin REST OpenAPI is not published at
// a stable raw URL. The link below is a widely mirrored community copy;
// swap for the official spec once Shopify publishes one.
export const shopify: CatalogEntry = {
  slug: 'shopify',
  name: 'Shopify Admin',
  tagline: 'Storefront + admin API',
  category: 'other',
  logo: 'H',
  specUrl:
    'https://raw.githubusercontent.com/allengrant/shopify_openapi/master/admin_api.json',
  specFormat: 'openapi',
  homepage: 'https://shopify.dev/docs/api/admin-rest',
  quickstart: 'npx carbon-dev emulate --catalog shopify',
  seedResources: ['products', 'orders', 'customers', 'fulfillments'],
  description:
    'Boot a local Shopify Admin replica for storefront and back-office development. Create products, place orders, and process fulfillments — Carbon persists shop state between requests so your commerce integration behaves like a real store.',
};
