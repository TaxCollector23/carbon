import type { CatalogEntry } from '../types.js';

export const linear: CatalogEntry = {
  slug: 'linear',
  name: 'Linear',
  tagline: 'GraphQL issue tracker',
  category: 'dev-platform',
  logo: 'L',
  // Linear only publishes a GraphQL endpoint. Carbon's GraphQL ingest
  // introspects the live schema from this URL.
  specUrl: 'https://api.linear.app/graphql',
  specFormat: 'graphql',
  homepage: 'https://developers.linear.app/docs',
  quickstart: 'npx carbon-dev emulate --catalog linear',
  seedResources: ['Issue', 'Project', 'Team', 'User'],
  description:
    'A local GraphQL replica of the Linear API. Query issues, mutate projects, subscribe to comments — Carbon holds workspace state between requests so your Linear-powered tool can be built and tested without connecting to a real Linear workspace.',
};
