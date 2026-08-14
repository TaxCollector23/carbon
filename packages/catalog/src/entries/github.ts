import type { CatalogEntry } from '../types.js';

export const github: CatalogEntry = {
  slug: 'github',
  name: 'GitHub',
  tagline: 'REST v3 API',
  category: 'dev-platform',
  logo: 'G',
  specUrl:
    'https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json',
  specFormat: 'openapi',
  homepage: 'https://docs.github.com/rest',
  quickstart: 'npx carbon-dev emulate --catalog github',
  seedResources: ['repos', 'issues', 'pulls', 'users'],
  description:
    'A local GitHub REST v3 replica for tests and demos. Create repos, open issues, push pull requests — Carbon holds state between calls so bots and workflows can run end-to-end without touching github.com or burning your rate limit.',
};
