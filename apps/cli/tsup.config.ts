import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  clean: true,
  outExtension() {
    return { js: '.cjs' };
  },
  noExternal: [
    '@carbon/core',
    '@carbon/graph',
    '@carbon/parser',
    '@carbon/proxy',
    '@carbon/runtime',
    '@carbon/sdk',
    '@carbon/state',
    '@carbon/types',
  ],
});
