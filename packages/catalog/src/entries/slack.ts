import type { CatalogEntry } from '../types.js';

export const slack: CatalogEntry = {
  slug: 'slack',
  name: 'Slack',
  tagline: 'Web API',
  category: 'communication',
  logo: '#',
  specUrl:
    'https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json',
  specFormat: 'openapi',
  homepage: 'https://api.slack.com/methods',
  quickstart: 'npx carbon-dev emulate --catalog slack',
  seedResources: ['conversations', 'users', 'files', 'reactions'],
  description:
    'Mock the Slack Web API for bots and integrations. Post messages, open conversations, react — all locally. Carbon keeps channel and user state between calls so multi-step flows behave the way a real workspace would.',
};
