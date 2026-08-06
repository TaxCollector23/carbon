import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';

/**
 * Server-side Better Auth handle. Phase One boots with the in-memory adapter so
 * `pnpm dev` works without a database — swap for the Drizzle adapter once
 * @carbon/database migrations have been applied.
 */
const db: Record<string, unknown[]> = {};

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET ?? 'dev-secret-change-me',
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3001',
  emailAndPassword: { enabled: true },
  database: memoryAdapter(db),
});
