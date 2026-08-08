import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { CarbonError } from '@carbon/core';
import { schema } from '@carbon/database';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { AppContext } from '../context.js';

/**
 * Firebase Admin auth.
 *
 * The web dashboard signs users in with the Firebase client SDK. The API only
 * knows how to accept `ck_live_*` machine keys, so browser sessions had no way
 * to talk to it. This plugin adds a second auth path: verify a Firebase ID
 * token on `Authorization: Bearer <token>` and resolve the caller's user +
 * org, attaching them to the request as `req.firebaseUser`.
 *
 * OFF by default in dev — the plugin registration is a no-op when
 * `FIREBASE_PROJECT_ID` is not set. That means a local machine without any
 * Firebase env vars boots exactly like it does today.
 *
 * Coexists with the API-key hook: only Bearer tokens that don't look like
 * `ck_live_*` are considered. Everything else is left untouched so the
 * existing `x-carbon-key` (and any Bearer-carrying API key clients) still
 * reach `registerApiKeyAuth` unchanged.
 */

export interface FirebaseAuthPluginOptions {
  readonly projectId: string;
  readonly clientEmail: string;
  readonly privateKey: string;
}

export interface FirebaseUser {
  readonly uid: string;
  readonly email: string;
  readonly userId: string;
  readonly orgId: string;
}

/** Attach shape — read from routes as `(req as FirebaseAuthenticatedRequest).firebaseUser`. */
export interface FirebaseAuthenticatedRequest extends FastifyRequest {
  firebaseUser?: FirebaseUser;
}

/**
 * When `opts` is undefined (i.e. `FIREBASE_PROJECT_ID` unset) this returns
 * without registering anything. The caller — `server.ts` — guards the call
 * behind the same env, but keeping the no-op path here means any future
 * caller (a test, a script) is safe to invoke it unconditionally.
 */
export async function registerFirebaseAuth(
  app: FastifyInstance,
  ctx: AppContext,
  opts: FirebaseAuthPluginOptions | undefined,
): Promise<void> {
  if (!opts) return;

  // Firebase Admin holds a process-global registry of initialized apps. Guard
  // the init so re-registration (tests, warm reload) doesn't throw.
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: opts.projectId,
        clientEmail: opts.clientEmail,
        privateKey: opts.privateKey,
      }),
      projectId: opts.projectId,
    });
  }

  app.addHook('onRequest', async (req) => {
    const token = extractBearerToken(req);
    if (!token) return;
    // API keys are sometimes presented as `Authorization: Bearer ck_live_...`
    // — skip and let the api-key hook take it.
    if (token.startsWith('ck_live_')) return;

    let decoded: { uid: string; email?: string };
    try {
      decoded = await getAuth().verifyIdToken(token);
    } catch (err) {
      throw new CarbonError({
        code: 'CARBON_UNAUTHENTICATED',
        message: 'Invalid Firebase token',
        cause: err,
        expose: true,
      });
    }

    if (!decoded.email) {
      throw new CarbonError({
        code: 'CARBON_UNAUTHENTICATED',
        message: 'Firebase token has no email claim',
        expose: true,
      });
    }
    const email = decoded.email.toLowerCase();

    const { userId, orgId } = await resolveUserAndOrg(ctx, decoded.uid, email);

    (req as FirebaseAuthenticatedRequest).firebaseUser = {
      uid: decoded.uid,
      email,
      userId,
      orgId,
    };
  });

  ctx.logger.info('firebase_auth.registered', { projectId: opts.projectId });
}

/**
 * Resolves the token's identity to a Carbon user + org, creating both on
 * first sight. This is intentionally a per-request read-then-maybe-write:
 * the write cost is paid only for a brand-new user, and idempotency is
 * guaranteed by the unique index on `users.email` and `organizations.slug`.
 */
async function resolveUserAndOrg(
  ctx: AppContext,
  _uid: string,
  email: string,
): Promise<{ userId: string; orgId: string }> {
  const [existingUser] = await ctx.db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
  } else {
    userId = randomUUID();
    // If a parallel request wins the race, `email` is uniquely indexed and
    // the second insert throws — fall back to a fresh select.
    try {
      await ctx.db.insert(schema.users).values({ id: userId, email });
    } catch {
      const [reread] = await ctx.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      if (!reread) throw new Error('user insert race resolution failed');
      userId = reread.id;
    }
  }

  const [membership] = await ctx.db
    .select({ orgId: schema.memberships.orgId })
    .from(schema.memberships)
    .where(eq(schema.memberships.userId, userId))
    .limit(1);
  if (membership) return { userId, orgId: membership.orgId };

  // First-time sign-in: create the user's personal org. The slug is derived
  // from the email's local part, sanitized and de-duplicated per-user so two
  // people with the same prefix (alice@foo, alice@bar) don't collide.
  const orgId = randomUUID();
  const slug = personalOrgSlug(email, userId);
  await ctx.db.insert(schema.organizations).values({
    id: orgId,
    slug,
    name: `${email.split('@')[0] ?? 'user'}'s org`,
  });
  await ctx.db.insert(schema.memberships).values({
    id: randomUUID(),
    userId,
    orgId,
    role: 'owner',
  });
  return { userId, orgId };
}

function personalOrgSlug(email: string, userId: string): string {
  const prefix = (email.split('@')[0] ?? 'user')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const cleanPrefix = prefix.length > 0 ? prefix : 'user';
  // Append 8 hex chars of the userId so the slug is unique per user even
  // when the local part collides.
  const suffix = userId.replace(/-/g, '').slice(0, 8);
  return `${cleanPrefix}-${suffix}`;
}

function extractBearerToken(req: FastifyRequest): string | null {
  const raw = req.headers.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header || typeof header !== 'string') return null;
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/** Look up an ergonomic accessor for downstream code. */
export function getFirebaseUser(req: FastifyRequest): FirebaseUser | undefined {
  // Re-exported as a helper so callers don't have to cast to
  // FirebaseAuthenticatedRequest every time.
  return (req as FirebaseAuthenticatedRequest).firebaseUser;
}

// Type augmentation is deliberately not declared here: Fastify's global
// FastifyRequest augmentation would leak `firebaseUser` into every route
// even when the plugin isn't registered. Callers cast on read instead.
export const __private = { personalOrgSlug };
