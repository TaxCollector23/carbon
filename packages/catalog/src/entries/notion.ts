import type { CatalogEntry } from '../types.js';

// TODO: verify spec url — Notion does not publish a first-party OpenAPI
// document. The URL below points to a well-known community-maintained
// spec; swap it for the official one if Notion ever ships one.
export const notion: CatalogEntry = {
  slug: 'notion',
  name: 'Notion',
  tagline: 'Workspace + database API',
  category: 'dev-platform',
  logo: 'N',
  specUrl: 'https://raw.githubusercontent.com/makenotion/notion-sdk-js/main/src/api-endpoints.ts',
  specFormat: 'openapi',
  homepage: 'https://developers.notion.com/',
  quickstart: 'npx carbon-api emulate --catalog notion',
  seedResources: ['pages', 'databases', 'blocks', 'users'],
  description:
    'A stateful mock of the Notion API for docs and workspace tools. Create pages, query databases, append blocks — Carbon replays the exact shape of Notion responses without needing a real workspace token.',
};
