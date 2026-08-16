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
  const baseURL = configuredBaseUrl();
  const trustedOrigins = configuredTrustedOrigins(baseURL);
  const socialProviders = configuredSocialProviders();

  if (process.env.DATABASE_URL) {
    const { db } = createDatabase({
      url: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? true : undefined,
    });
    return betterAuth({
      secret,
      baseURL,
      trustedOrigins,
      emailAndPassword: { enabled: true },
      socialProviders,
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
    trustedOrigins,
    emailAndPassword: { enabled: true },
    socialProviders,
    database: memoryAdapter(memoryDb),
  });
})();

function configuredBaseUrl(): string {
  if (process.env.BETTER_AUTH_URL?.trim()) return process.env.BETTER_AUTH_URL.trim();
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`;
  }
  if (process.env.VERCEL_URL?.trim()) return `https://${process.env.VERCEL_URL.trim()}`;
  return process.env.NODE_ENV === 'production'
    ? 'https://carbon-dashboard-lovat.vercel.app'
    : 'http://localhost:3001';
}

function configuredTrustedOrigins(baseURL: string): string[] {
  const origins = new Set<string>();
  for (const value of [
    baseURL,
    'http://localhost:3001',
    'https://carbon-dashboard-lovat.vercel.app',
    'https://carbon-dashboard-rangan23.vercel.app',
    'https://carbon-dashboard-ranganbalaji23-8314-rangan23.vercel.app',
    'https://carbon-web-psi.vercel.app',
    'https://carbon-web-rangan23.vercel.app',
    'https://carbon-web-ranganbalaji23-8314-rangan23.vercel.app',
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '',
    process.env.NEXT_PUBLIC_MARKETING_URL,
    ...parseCsv(process.env.BETTER_AUTH_TRUSTED_ORIGINS),
  ]) {
    const origin = toOrigin(value);
    if (origin) origins.add(origin);
  }
  return [...origins];
}

function parseCsv(value: string | undefined): string[] {
  return value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function toOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
}

export function configuredSocialProviders() {
  return {
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            prompt: 'select_account' as const,
          },
        }
      : {}),
  };
}
