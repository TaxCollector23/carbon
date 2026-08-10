import { defineConfig } from 'vitest/config';

/**
 * Integration suite for @carbon/storage — hits a real S3-compatible endpoint
 * (MinIO locally, MinIO service container in CI). Each test is gated on
 * `STORAGE_MINIO_URL`; the file becomes a no-op when the env var is unset,
 * so the config is safe to keep enabled everywhere.
 *
 * Kept separate from the default `vitest run` so `pnpm --filter @carbon/storage
 * test` (the fast unit suite) stays runnable on a machine without Docker.
 * CI wires this up as its own `storage-integration` job — see
 * `.github/workflows/ci.yml`.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    environment: 'node',
    // Network + bucket lifecycle dominate wall-clock cost; a warm CI runner
    // finishes in a couple of seconds but cold pulls can stretch the first
    // request past the vitest default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
