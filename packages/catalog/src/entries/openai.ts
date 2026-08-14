import type { CatalogEntry } from '../types.js';

export const openai: CatalogEntry = {
  slug: 'openai',
  name: 'OpenAI',
  tagline: 'Chat, embeddings, files, assistants',
  category: 'ai',
  logo: 'O',
  specUrl: 'https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml',
  specFormat: 'openapi',
  homepage: 'https://platform.openai.com/docs/api-reference',
  quickstart: 'npx carbon-api emulate --catalog openai',
  seedResources: ['chat.completions', 'embeddings', 'files', 'assistants'],
  description:
    'Develop against the OpenAI API without spending tokens. Carbon serves chat completions, embeddings, files, and assistants locally with deterministic responses — perfect for CI, benchmarks, and offline demos.',
};
