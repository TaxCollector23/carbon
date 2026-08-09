import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Integration tests live alongside unit tests but need a real Postgres,
    // so they run under a separate config (`vitest.integration.config.ts`).
    // Excluding them here keeps `pnpm --filter @carbon/api test` fast and
    // usable on a machine without Postgres.
    exclude: ['**/*.integration.test.ts', 'node_modules/**', 'dist/**'],
    environment: 'node',
  },
});
