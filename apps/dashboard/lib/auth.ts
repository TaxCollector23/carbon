import { betterAuth } from 'better-auth';

/**
 * Server-side Better Auth handle. The database adapter is wired in as soon as
 * @carbon/database ships its migrations; for the Phase One shell we boot with
 * an in-memory adapter so `pnpm dev` works out of the box.
 */
export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET ?? 'dev-secret-change-me',
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3001',
  emailAndPassword: { enabled: true },
});
