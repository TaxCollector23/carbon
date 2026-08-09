/**
 * Shared bootstrap for API integration tests.
 *
 * Each `*.integration.test.ts` file that opts in calls `setupIntegration()`
 * from inside a top-level `beforeAll`. That call:
 *
 *   1. Reads Postgres connection info from `INTEGRATION_DATABASE_URL`, or
 *      falls back to `PGHOST`/`PGUSER`/`PGPORT`/`PGPASSWORD` env vars.
 *   2. Creates a fresh, disposable database (`carbon_int_<epoch>_<rand>`).
 *   3. Runs the Drizzle migrations against it.
 *   4. Seeds a fixture organization + project + admin api-key.
 *   5. Boots the API in-process via `buildServer` and returns the Fastify
 *      instance for tests to `.inject(...)` against — no HTTP listener.
 *
 * `afterAll` calls `.cleanup()` to close the app, close the pool, and drop
 * the database so the CI Postgres never accumulates state across runs.
 *
 * When neither `INTEGRATION_DATABASE_URL` nor `PGHOST` is set, callers skip
 * the whole suite via `describe.skipIf(!shouldRunIntegration())` — so
 * `pnpm --filter @carbon/api test` on a laptop without Postgres stays green.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { FastifyInstance } from 'fastify';
import { NoopLogger, makeId } from '@carbon/core';
import { createDatabase, schema, type Database } from '@carbon/database';
import { MemoryStorage } from '@carbon/storage';
import { createEmulatorRegistry } from './src/services/emulator-registry.js';
import { mintApiKey, type MintedApiKey } from './src/services/api-keys.js';
import { buildServer } from './src/server.js';
import type { AppContext } from './src/context.js';

export interface IntegrationEnv {
  /** Admin URL — used to `CREATE DATABASE` and `DROP DATABASE`. */
  readonly adminUrl: string;
  /** Same server, but pointing at the freshly created integration DB. */
  readonly integrationUrl: string;
  readonly databaseName: string;
}

export interface IntegrationHandle {
  readonly app: FastifyInstance;
  readonly ctx: AppContext;
  readonly db: Database;
  readonly orgId: string;
  readonly projectId: string;
  readonly projectSlug: string;
  readonly apiKey: MintedApiKey;
  /** Header block to pass to `app.inject(...)` for authenticated calls. */
  readonly authHeaders: Record<string, string>;
  /** Tear down the app, pool, and database. Idempotent. */
  cleanup(): Promise<void>;
}

/**
 * True when the current process has enough env to reach Postgres. Tests
 * wrap `describe` blocks with `describe.skipIf(!shouldRunIntegration())`
 * so they no-op gracefully when Postgres isn't around.
 */
export function shouldRunIntegration(): boolean {
  if (process.env.CARBON_SKIP_INTEGRATION === '1') return false;
  return Boolean(process.env.INTEGRATION_DATABASE_URL || process.env.PGHOST);
}

function resolveEnv(): IntegrationEnv {
  const dbName = `carbon_int_${Date.now()}_${Math.floor(Math.random() * 1e6)
    .toString(16)
    .padStart(6, '0')}`;
  if (process.env.INTEGRATION_DATABASE_URL) {
    const url = new URL(process.env.INTEGRATION_DATABASE_URL);
    const admin = new URL(url.toString());
    admin.pathname = `/${process.env.INTEGRATION_PG_ADMIN_DB ?? 'postgres'}`;
    const integration = new URL(url.toString());
    integration.pathname = `/${dbName}`;
    return {
      adminUrl: admin.toString(),
      integrationUrl: integration.toString(),
      databaseName: dbName,
    };
  }
  const host = process.env.PGHOST ?? 'localhost';
  const port = process.env.PGPORT ?? '5432';
  const user = process.env.PGUSER ?? process.env.USER ?? 'postgres';
  const password = process.env.PGPASSWORD ? `:${encodeURIComponent(process.env.PGPASSWORD)}` : '';
  const adminDb = process.env.INTEGRATION_PG_ADMIN_DB ?? 'postgres';
  const base = `postgresql://${encodeURIComponent(user)}${password}@${host}:${port}`;
  return {
    adminUrl: `${base}/${adminDb}`,
    integrationUrl: `${base}/${dbName}`,
    databaseName: dbName,
  };
}

function resolveMigrationsFolder(): string {
  // apps/api/vitest.setup-integration.ts → up 2 = repo root.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', 'packages', 'database', 'migrations');
}

export async function setupIntegration(): Promise<IntegrationHandle> {
  const env = resolveEnv();

  // 1. Create the disposable database. `CREATE DATABASE` can't run inside a
  // transaction, and postgres.js pools per-URL, so use a dedicated client
  // for the DDL and close it immediately.
  const admin = postgres(env.adminUrl, { max: 1, onnotice: () => undefined });
  try {
    await admin.unsafe(`CREATE DATABASE "${env.databaseName}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }

  // 2. Run migrations against the fresh DB.
  const migrationClient = postgres(env.integrationUrl, {
    max: 1,
    onnotice: () => undefined,
  });
  try {
    const migrationDb = drizzle(migrationClient);
    await migrate(migrationDb, { migrationsFolder: resolveMigrationsFolder() });
  } finally {
    await migrationClient.end({ timeout: 5 });
  }

  // 3. Production database client (pooled) for the running server.
  const { db, sql } = createDatabase({
    url: env.integrationUrl,
    maxConnections: 5,
    prepare: true,
  });

  // 4. Seed a fixture org + project.
  const orgId = 'org_test';
  const projectId = makeId('prj');
  const projectSlug = 'integration';
  await db
    .insert(schema.organizations)
    .values({ id: orgId, slug: 'integration-test', name: 'Integration Test Org' })
    .onConflictDoNothing();
  await db
    .insert(schema.projects)
    .values({ id: projectId, orgId, slug: projectSlug, name: 'Integration Test Project' });

  const storage = new MemoryStorage();
  const emulators = createEmulatorRegistry({ storage, logger: NoopLogger });
  const ctx: AppContext = {
    logger: NoopLogger,
    db,
    storage,
    ingestion: {
      // The routes exercised here never call `ingestion.ingest`; a stub is
      // enough to satisfy the type of AppContext.
      ingest: async () => ({}) as never,
    } as unknown as AppContext['ingestion'],
    emulators,
  };

  // 5. Mint an admin api-key for the fixture org and boot the API with
  // enforced auth so every route runs the same middleware chain that
  // production does.
  const apiKey = await mintApiKey(ctx, {
    orgId,
    name: 'integration',
    scopes: ['admin'],
  });
  const app = await buildServer(ctx, NoopLogger, {
    auth: { mode: 'enforced' },
  });
  await app.ready();

  let closed = false;
  return {
    app,
    ctx,
    db,
    orgId,
    projectId,
    projectSlug,
    apiKey,
    authHeaders: { 'x-carbon-key': apiKey.presented },
    async cleanup() {
      if (closed) return;
      closed = true;
      try {
        await app.close();
      } catch {
        /* best-effort */
      }
      try {
        await emulators.shutdown();
      } catch {
        /* best-effort */
      }
      try {
        await sql.end({ timeout: 5 });
      } catch {
        /* best-effort */
      }
      const dropClient = postgres(env.adminUrl, { max: 1, onnotice: () => undefined });
      try {
        // Force-terminate stragglers so DROP DATABASE isn't blocked by a
        // lingering pool connection.
        await dropClient.unsafe(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${env.databaseName}' AND pid<>pg_backend_pid()`,
        );
        await dropClient.unsafe(`DROP DATABASE IF EXISTS "${env.databaseName}"`);
      } finally {
        await dropClient.end({ timeout: 5 });
      }
    },
  };
}
