import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, gt, sql as dsql } from 'drizzle-orm';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';

/**
 * Better Auth session verification.
 *
 * The dashboard (`apps/dashboard`) signs users in with Better Auth, which
 * persists sessions in the shared Carbon Postgres (`schema.sessions`,
 * `schema.users`). Any browser session cookie or Bearer token issued by that
 * flow is the same token stored in `sessions.token`. This plugin looks that
 * token up server-side and attaches the resolved user + org membership as
 * `req.sessionUser`.
 *
 * The plugin NEVER rejects the request. Missing/invalid/expired tokens leave
 * `sessionUser` undefined; downstream routes (via `requireScope` or the
 * project-access resolver) decide whether that's allowed. This lets the
 * hook coexist with the API-key path — API-key callers won't have a session
 * cookie, and the api-key hook already handles their auth.
 *
 * Design decisions:
 *   - Bearer tokens starting with `ck_live_` are Carbon API keys — skip them
 *     so the api-key hook takes them.
 *   - When a user belongs to multiple orgs, an `X-Carbon-Org` header selects
 *     which one. Any other value is ignored (falls back to the first
 *     membership) rather than 400ing — again, this hook never rejects.
 *   - Never trust the client's user id; the user id used is the one joined
 *     from the `sessions` row.
 */

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly orgId?: string;
  readonly role?: 'owner' | 'admin' | 'member';
}

/** Attach shape — read from routes as `(req as SessionAuthenticatedRequest).sessionUser`. */
export interface SessionAuthenticatedRequest extends FastifyRequest {
  sessionUser?: SessionUser;
}

/**
 * Better Auth's default cookie name. The `__Secure-` variant is issued when
 * the cookie is set with `Secure` on an https origin.
 */
const SESSION_COOKIE_NAMES = ['better-auth.session_token', '__Secure-better-auth.session_token'];

export async function registerSessionAuth(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.addHook('onRequest', async (req) => {
    const token = extractToken(req);
    if (!token) return;

    // Look up the session row. `expiresAt > now()` uses the DB clock so a
    // stale process clock cannot silently accept an expired session.
    const [session] = await ctx.db
      .select({
        userId: schema.sessions.userId,
        email: schema.users.email,
      })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .where(and(eq(schema.sessions.token, token), gt(schema.sessions.expiresAt, dsql`now()`)))
      .limit(1);

    if (!session) return;

    // Pick a membership. When the user belongs to multiple orgs, honour the
    // X-Carbon-Org header when it names one of them; otherwise fall back to
    // the first one returned.
    const memberships = await ctx.db
      .select({ orgId: schema.memberships.orgId, role: schema.memberships.role })
      .from(schema.memberships)
      .where(eq(schema.memberships.userId, session.userId));

    let chosen: { orgId: string; role: 'owner' | 'admin' | 'member' } | undefined;
    if (memberships.length > 0) {
      const requested = requestedOrgId(req);
      const requestedMatch = requested
        ? memberships.find((m) => m.orgId === requested)
        : undefined;
      chosen = requestedMatch ?? memberships[0];
    }

    (req as SessionAuthenticatedRequest).sessionUser = {
      id: session.userId,
      email: session.email,
      ...(chosen ? { orgId: chosen.orgId, role: chosen.role } : {}),
    };
  });

  ctx.logger.info('session_auth.registered', {});
}

function extractToken(req: FastifyRequest): string | null {
  // Bearer header wins over cookie, matching every other route's expectation.
  const raw = req.headers.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (header && typeof header === 'string' && header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (token.length > 0 && !token.startsWith('ck_live_')) return token;
  }

  const cookieHeader = req.headers.cookie;
  const cookieStr = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
  if (!cookieStr || typeof cookieStr !== 'string') return null;
  return parseSessionCookie(cookieStr);
}

function parseSessionCookie(cookieHeader: string): string | null {
  // Manual cookie parse — @fastify/cookie is not registered on the API, and
  // pulling it in for one cookie is not worth the plugin ordering churn.
  for (const raw of cookieHeader.split(';')) {
    const eq = raw.indexOf('=');
    if (eq < 0) continue;
    const name = raw.slice(0, eq).trim();
    if (!SESSION_COOKIE_NAMES.includes(name)) continue;
    let value = raw.slice(eq + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      // Fall through with the raw value.
    }
    // Better Auth sometimes signs the cookie as `<token>.<signature>`. The
    // token portion is what's stored in `sessions.token`.
    const dot = value.indexOf('.');
    const token = dot > 0 ? value.slice(0, dot) : value;
    if (token.length > 0) return token;
  }
  return null;
}

function requestedOrgId(req: FastifyRequest): string | undefined {
  const raw = req.headers['x-carbon-org'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Ergonomic accessor so routes don't have to cast. */
export function getSessionUser(req: FastifyRequest): SessionUser | undefined {
  return (req as SessionAuthenticatedRequest).sessionUser;
}
