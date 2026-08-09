// Bundles the extension into a single CJS file. VS Code loads extensions via
// require(), so the output MUST be CommonJS regardless of the source module
// system. External `vscode` — the runtime supplies it.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'dist/extension.cjs',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
});
