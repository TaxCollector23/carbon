import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['*.test.ts'],
    // Replicas bind real ports; give the suite a comfortable ceiling.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
