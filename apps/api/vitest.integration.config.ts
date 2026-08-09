import { defineConfig } from 'vitest/config';

/**
 * Integration suite — hits a real Postgres. Each test file boots the API
 * against a fresh disposable database (see `src/test-support/integration.ts`)
 * so suites cannot leak state into one another.
 *
 * Kept in a separate config so `pnpm --filter @carbon/api test` (the fast
 * unit suite) stays runnable on a machine without Postgres. CI wires this
 * up as its own job — see `.github/workflows/ci.yml`'s `integration` job.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    environment: 'node',
    // DB setup + migrations dominate the wall-clock cost of these tests;
    // 60s is a comfortable ceiling on a warm CI runner.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Fresh DB per file already gives us isolation — running files in
    // parallel just multiplies the createdb cost without a correctness win.
    fileParallelism: false,
  },
});
