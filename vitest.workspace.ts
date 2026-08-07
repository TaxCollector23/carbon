import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/core',
  'packages/parser',
  'packages/state',
  'packages/graph',
  'packages/proxy',
  'packages/runtime',
  'packages/ingestion',
  'apps/api',
]);
