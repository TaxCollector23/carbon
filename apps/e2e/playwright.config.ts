import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Playwright config for the Carbon dashboard end-to-end suite.
 *
 * Boots the real API (port 4000) and the real dashboard (port 3001) against
 * a freshly-created Postgres database whose name is unique per run — so two
 * concurrent test runs never fight over rows. globalSetup runs setup.sh,
 * which createdb's the DB, applies migrations, and seeds the fixture org.
 *
 * We deliberately compute DATABASE_URL at config-load time (rather than
 * inside globalSetup) so it can be injected into the webServer env, which
 * Playwright expects as a static object.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const pgUser = process.env.CARBON_E2E_PG_USER || process.env.USER || 'postgres';
const pgHost = process.env.CARBON_E2E_PG_HOST || 'localhost';
const pgPort = process.env.CARBON_E2E_PG_PORT || '5432';
// Password from PGPASSWORD or explicit override; embedded in the URL so
// clients that don't read the environment (Playwright's child processes,
// child bash scripts started via execFileSync with a custom env) still work.
const pgPassword = process.env.CARBON_E2E_PG_PASSWORD || process.env.PGPASSWORD || '';
const userInfo = pgPassword
  ? `${encodeURIComponent(pgUser)}:${encodeURIComponent(pgPassword)}`
  : encodeURIComponent(pgUser);

// Allow the caller to point at an existing DB (CI passes CARBON_E2E_DB from
// a Postgres service container). Fall back to a per-run random name locally.
const dbName = process.env.CARBON_E2E_DB || `carbon_e2e_${Date.now()}`;
const databaseUrl =
  process.env.CARBON_E2E_DATABASE_URL || `postgresql://${userInfo}@${pgHost}:${pgPort}/${dbName}`;

// Propagate so globalSetup, seed.ts and any child process pick them up.
process.env.CARBON_E2E_DB = dbName;
process.env.CARBON_E2E_PG_USER = pgUser;
process.env.CARBON_E2E_PG_HOST = pgHost;
process.env.CARBON_E2E_PG_PORT = pgPort;
process.env.DATABASE_URL = databaseUrl;
if (process.env.CARBON_E2E_DATABASE_URL) {
  // Caller supplied the URL directly — don't drop the DB in teardown.
  process.env.CARBON_E2E_DB_CALLER_OWNED = '1';
}

const API_URL = 'http://127.0.0.1:4000';
const DASHBOARD_URL = 'http://127.0.0.1:3001';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // Real DB and real server — running tests in parallel would race on rows
  // (created projects, keys). Keep it serial.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: path.join(here, 'scripts', 'global-setup.ts'),
  globalTeardown: path.join(here, 'scripts', 'global-teardown.ts'),
  use: {
    baseURL: DASHBOARD_URL,
    storageState: {
      cookies: [],
      origins: [
        {
          origin: DASHBOARD_URL,
          localStorage: [{ name: 'carbon.orgId', value: 'org_test' }],
        },
      ],
    },
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @carbon/api dev',
      cwd: repoRoot,
      url: `${API_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        DATABASE_URL: databaseUrl,
        CARBON_AUTH_MODE: 'disabled',
        API_HOST: '127.0.0.1',
        API_PORT: '4000',
        LOG_LEVEL: 'warn',
        NODE_ENV: 'development',
        ALLOWED_ORIGINS: `${DASHBOARD_URL},http://localhost:3001`,
      },
    },
    {
      command: 'pnpm --filter @carbon/dashboard dev',
      cwd: repoRoot,
      url: DASHBOARD_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        DATABASE_URL: databaseUrl,
        NEXT_PUBLIC_CARBON_API_URL: API_URL,
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
  ],
});
