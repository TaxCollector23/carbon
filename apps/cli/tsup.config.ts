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
  // pino uses thread-stream / pino-pretty in worker threads and resolves
  // `lib/worker.js` and `worker.js` from its own package directory at runtime.
  // Bundling those into `index.cjs` breaks that resolution — the worker file
  // is no longer on disk next to the require site. Keep pino and its worker
  // helpers external so they resolve from node_modules where their worker
  // scripts still live.
  external: ['pino', 'pino-pretty', 'thread-stream', 'pino-worker', 'pino-file'],
});
