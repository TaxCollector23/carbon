import { defineConfig } from 'tsup';

// Bundle every @carbon/* workspace package into the shipped dist so the
// container image doesn't need to resolve raw-.ts workspace exports at
// runtime. Third-party deps stay external — they resolve from node_modules
// as usual.
export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  clean: true,
  noExternal: [/^@carbon\//],
  sourcemap: true,
  target: 'es2022',
  skipNodeModulesBundle: true,
});
