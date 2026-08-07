import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createDatabase, schema } from '@carbon/database';

/**
 * Server-side Better Auth handle.
 *
 * When DATABASE_URL is set, we mount the Drizzle adapter against the shared
 * Carbon Postgres. Without it, we fall back to the memory adapter so
 * `pnpm dev` works out of the box for contributors who have not yet booted
 * `docker compose up -d`.
 */
export const auth = (() => {
  const secret = process.env.BETTER_AUTH_SECRET ?? 'dev-secret-change-me';
  const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3001';

  if (process.env.DATABASE_URL) {
    const { db } = createDatabase({
      url: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? true : undefined,
    });
    return betterAuth({
      secret,
      baseURL,
      emailAndPassword: { enabled: true },
      // Better Auth looks up tables by singular name (`user`, `session`, ...).
      // Our Drizzle exports are plural, so we map explicitly. Do not remove
      // this mapping unless you also rename the tables in @carbon/database.
      database: drizzleAdapter(db, {
        provider: 'pg',
        schema: {
          user: schema.users,
          session: schema.sessions,
          account: schema.accounts,
          verification: schema.verifications,
        },
      }),
    });
  }

  const memoryDb: Record<string, unknown[]> = {};
  return betterAuth({
    secret,
    baseURL,
    emailAndPassword: { enabled: true },
    database: memoryAdapter(memoryDb),
  });
})();
