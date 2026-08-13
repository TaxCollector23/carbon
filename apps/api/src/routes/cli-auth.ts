import type { FastifyInstance } from 'fastify';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { CarbonError, NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { SessionAuthenticatedRequest } from '../plugins/session-auth.js';
import { mintApiKey } from '../services/api-keys.js';
import { createSecretStore, type SecretStore } from '../services/cli-auth-secret-store.js';
import { getActor, recordEvent } from '../services/events.js';
import { zodBody, zodQuery, zodResponse } from '../plugins/schema-helpers.js';

const StartResponse = z.object({
  sessionId: z.string(),
  verifier: z.string(),
  verificationUrl: z.string(),
  expiresAt: z.string(),
});
const PollResponse = z
  .object({
    status: z.enum(['pending', 'approved', 'denied', 'expired']),
    key: z.string().optional(),
  })
  .passthrough();
const ApproveResponse = z
  .object({
    status: z.enum(['approved']).optional(),
    orgId: z.string().optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        availableOrgs: z.array(z.unknown()).optional(),
      })
      .optional(),
  })
  .passthrough();
const DenyResponse = z.object({ status: z.string() });
const PollQuery = z.object({ verifier: z.string() });

/**
 * CLI device-authorization flow ("gh auth login" style).
 *
 * The CLI POSTs /start (unauthenticated) → opens the browser at
 * verificationUrl → polls /:id?verifier=... until the row flips to `approved`
 * and the secret is revealed exactly once.
 *
 * Two identifiers per session:
 *   - `sessionId` — 8-char base32 human-readable (no I/O/0/1). Goes in the
 *     browser URL and is safe to say aloud.
 *   - `verifier` — 32-char base64url random. Kept by the CLI. Any browser
 *     visitor who only has the sessionId cannot poll for the minted key.
 *
 * Rate-limiting: the unauthenticated /start and /:id endpoints must be tight
 * per-IP so an attacker cannot spray sessionIds. The registration attaches an
 * onRequest hook that shrinks the global control-plane rate limit for these
 * paths (10/min per IP) on top of whatever the server already applies.
 */

const BASE32_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
const SESSION_TTL_MS = 10 * 60 * 1000;
const APPROVE_LIMIT = 10;
const APPROVE_WINDOW_MS = 60_000;

const StartReply = z.object({}); // (kept for future doc use)
void StartReply;

const ApproveBody = z.object({
  orgId: z.string().min(1).optional(),
});

function generateSessionId(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    out += BASE32_ALPHABET[bytes[i]! % BASE32_ALPHABET.length];
  }
  return out;
}

function generateVerifier(): string {
  return randomBytes(24).toString('base64url'); // 32 chars
}

function verifierMatches(expected: string, presented: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(presented, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface RateBucket {
  count: number;
  resetAt: number;
}

/**
 * Small in-process IP rate limiter for the unauthenticated endpoints. The
 * global registerControlPlaneRateLimit already caps everything, but that
 * budget is shared across every anonymous endpoint. This second layer keeps
 * device-auth-specific abuse from cannibalizing the global bucket.
 */
function makeIpLimiter(max: number, windowMs: number) {
  const buckets = new Map<string, RateBucket>();
  return function check(ip: string): boolean {
    const now = Date.now();
    const b = buckets.get(ip);
    if (!b || b.resetAt <= now) {
      buckets.set(ip, { count: 1, resetAt: now + windowMs });
      return true;
    }
    b.count += 1;
    return b.count <= max;
  };
}

/**
 * Paths that must be added to the API's PUBLIC_PATHS list so the api-key
 * middleware does not reject unauthenticated CLI login traffic. `/approve` and
 * `/deny` are intentionally NOT in this list — they require a Better Auth
 * session cookie and read `sessionUser` off the request.
 */
export const CLI_AUTH_PUBLIC_PATHS: readonly string[] = [
  '/v1/cli-auth/start',
  '/v1/cli-auth/*',
];

export interface CliAuthOptions {
  /** Base URL used to construct verificationUrl. Defaults to env or localhost. */
  readonly dashboardUrl?: string;
  /**
   * Where minted secrets live between /approve and the CLI's next /poll.
   * Defaults to a Redis-backed store when `ctx.redis` is present, otherwise
   * an in-memory Map with per-entry TTL.
   */
  readonly secretStore?: SecretStore;
}

export async function registerCliAuthRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  opts: CliAuthOptions = {},
): Promise<void> {
  const dashboardUrl = (
    opts.dashboardUrl ??
    process.env.CARBON_DASHBOARD_URL ??
    'http://localhost:3001'
  ).replace(/\/+$/, '');
  // Transient store for the freshly minted CLI secret between /approve and
  // the next /poll. When `ctx.redis` is present (prod / staging), the store is
  // Redis-backed with a short TTL — meaning approve on API instance A and poll
  // on API instance B both see the same secret, so multi-instance deployments
  // no longer need sticky sessions for CLI login. When Redis is absent (local
  // dev, unit tests) the store transparently falls back to an in-process Map
  // with per-entry TTL — same semantics, single-process only.
  const secretStore =
    opts.secretStore ?? createSecretStore({ redis: ctx.redis, logger: ctx.logger });

  const startLimit = makeIpLimiter(APPROVE_LIMIT, APPROVE_WINDOW_MS);
  const pollLimit = makeIpLimiter(APPROVE_LIMIT * 6, APPROVE_WINDOW_MS); // 60/min polls

  // ---------------- POST /v1/cli-auth/start ----------------
  app.post('/v1/cli-auth/start', {
    schema: {
      summary: 'Start a CLI device-authorization session',
      description: 'Unauthenticated. Mints a short-lived `sessionId` + `verifier` pair. The CLI opens `verificationUrl` in the user\'s browser and polls the session until it flips to `approved`.',
      response: { 201: zodResponse(StartResponse) },
    },
  }, async (req, reply) => {
    if (!startLimit(req.ip)) {
      reply.header('retry-after', '60');
      throw new CarbonError({
        code: 'CARBON_RATE_LIMITED',
        message: 'Too many CLI auth start requests from this IP',
        expose: true,
      });
    }
    const id = generateSessionId();
    const verifier = generateVerifier();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await ctx.db.insert(schema.cliAuthSessions).values({
      id,
      verifier,
      status: 'pending',
      expiresAt,
    });
    reply.status(201);
    return {
      sessionId: id,
      verifier,
      verificationUrl: `${dashboardUrl}/cli-auth/${id}`,
      expiresAt: expiresAt.toISOString(),
    };
  });

  // ---------------- GET /v1/cli-auth/:sessionId ----------------
  app.get<{
    Params: { sessionId: string };
    Querystring: { verifier?: string };
  }>('/v1/cli-auth/:sessionId', {
    schema: {
      summary: 'Poll a CLI auth session',
      description: 'Unauthenticated. The CLI polls with its `verifier`; when the session flips to `approved` the minted key is revealed exactly once. Rate-limited per-IP.',
      querystring: zodQuery(PollQuery),
      response: { 200: zodResponse(PollResponse) },
    },
  }, async (req, reply) => {
    if (!pollLimit(req.ip)) {
      reply.header('retry-after', '60');
      throw new CarbonError({
        code: 'CARBON_RATE_LIMITED',
        message: 'Too many CLI auth poll requests from this IP',
        expose: true,
      });
    }
    const verifier = (req.query?.verifier ?? '').toString();
    if (!verifier) {
      throw new CarbonError({
        code: 'CARBON_INVALID_INPUT',
        message: 'verifier query parameter is required',
        expose: true,
      });
    }
    const [row] = await ctx.db
      .select()
      .from(schema.cliAuthSessions)
      .where(eq(schema.cliAuthSessions.id, req.params.sessionId))
      .limit(1);
    if (!row) throw new NotFoundError('cli auth session', req.params.sessionId);
    if (!verifierMatches(row.verifier, verifier)) {
      // Do not distinguish "wrong verifier" from "no such session" to a
      // client that guessed the sessionId — both surface as 404.
      throw new NotFoundError('cli auth session', req.params.sessionId);
    }

    const now = new Date();
    if (row.status !== 'expired' && row.expiresAt.getTime() <= now.getTime()) {
      await ctx.db
        .update(schema.cliAuthSessions)
        .set({ status: 'expired' })
        .where(eq(schema.cliAuthSessions.id, row.id));
      reply.status(410);
      return { status: 'expired' as const };
    }

    if (row.status !== 'approved') {
      return { status: row.status };
    }

    // Approved. Reveal the secret exactly once — if revealedAt is already
    // stamped, subsequent polls only return the status.
    if (row.revealedAt) {
      return { status: 'approved' as const };
    }
    if (!row.approvedApiKeyId) {
      // Consistency guard: an approved row must carry an api key id.
      ctx.logger.warn('cli_auth.approved_without_key', { sessionId: row.id });
      return { status: 'approved' as const };
    }
    const [key] = await ctx.db
      .select({
        id: schema.apiKeys.id,
        hash: schema.apiKeys.hash,
        prefix: schema.apiKeys.prefix,
      })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, row.approvedApiKeyId))
      .limit(1);
    // The presented secret is never persisted in the DB. /approve stashes it
    // in the transient `secretStore` (Redis when available, in-memory Map
    // otherwise), and we consume it here exactly once, stamping revealedAt so
    // subsequent polls only see the status.
    const secret = await secretStore.take(row.id);
    if (!secret) {
      // Server was restarted between approve and reveal, or a race lost the
      // secret. Force the user to restart the flow.
      ctx.logger.warn('cli_auth.secret_missing_on_reveal', { sessionId: row.id });
      reply.status(410);
      return { status: 'expired' as const };
    }
    await ctx.db
      .update(schema.cliAuthSessions)
      .set({ revealedAt: new Date() })
      .where(eq(schema.cliAuthSessions.id, row.id));
    void key; // keep the select for future audit/debug parity
    return { status: 'approved' as const, key: secret };
  });

  // ---------------- POST /v1/cli-auth/:sessionId/approve ----------------
  app.post<{ Params: { sessionId: string } }>(
    '/v1/cli-auth/:sessionId/approve',
    {
      schema: {
        summary: 'Approve a CLI auth session',
        description: 'Requires a signed-in Better Auth session. Mints an API key scoped to `orgId` (or the caller\'s only org) and stashes it for the CLI to fetch on its next poll.',
        body: zodBody(ApproveBody),
        response: { 200: zodResponse(ApproveResponse) },
      },
    },
    async (req, reply) => {
      const sessionUser = (req as SessionAuthenticatedRequest).sessionUser;
      if (!sessionUser) {
        throw new CarbonError({
          code: 'CARBON_UNAUTHENTICATED',
          message: 'Sign in to approve this CLI login',
          expose: true,
        });
      }
      const body = ApproveBody.parse(req.body ?? {});

      const memberships = await ctx.db
        .select({
          orgId: schema.memberships.orgId,
          role: schema.memberships.role,
          name: schema.organizations.name,
          slug: schema.organizations.slug,
        })
        .from(schema.memberships)
        .innerJoin(
          schema.organizations,
          eq(schema.organizations.id, schema.memberships.orgId),
        )
        .where(eq(schema.memberships.userId, sessionUser.id));

      if (memberships.length === 0) {
        throw new CarbonError({
          code: 'CARBON_FORBIDDEN',
          message: 'Your account is not a member of any organization',
          expose: true,
        });
      }

      let chosenOrgId: string;
      if (body.orgId) {
        const match = memberships.find((m) => m.orgId === body.orgId);
        if (!match) {
          throw new CarbonError({
            code: 'CARBON_FORBIDDEN',
            message: 'You are not a member of that organization',
            expose: true,
          });
        }
        chosenOrgId = match.orgId;
      } else if (memberships.length > 1) {
        reply.status(400);
        return {
          error: {
            code: 'CARBON_ORG_REQUIRED',
            message: 'orgId is required when the user belongs to multiple orgs',
            availableOrgs: memberships.map((m) => ({
              id: m.orgId,
              name: m.name,
              slug: m.slug,
              role: m.role,
            })),
          },
        };
      } else {
        chosenOrgId = memberships[0]!.orgId;
      }

      const [row] = await ctx.db
        .select()
        .from(schema.cliAuthSessions)
        .where(eq(schema.cliAuthSessions.id, req.params.sessionId))
        .limit(1);
      if (!row) throw new NotFoundError('cli auth session', req.params.sessionId);

      const now = new Date();
      if (row.expiresAt.getTime() <= now.getTime() || row.status === 'expired') {
        await ctx.db
          .update(schema.cliAuthSessions)
          .set({ status: 'expired' })
          .where(eq(schema.cliAuthSessions.id, row.id));
        reply.status(410);
        return { error: { code: 'CARBON_GONE', message: 'CLI auth session expired' } };
      }
      if (row.status !== 'pending') {
        throw new CarbonError({
          code: 'CARBON_CONFLICT',
          message: `CLI auth session already ${row.status}`,
          expose: true,
        });
      }

      const minted = await mintApiKey(ctx, {
        orgId: chosenOrgId,
        name: 'CLI login',
        scopes: ['read', 'write'],
        expiresAt: null,
      });
      await secretStore.put(row.id, minted.presented);

      await ctx.db
        .update(schema.cliAuthSessions)
        .set({
          status: 'approved',
          userId: sessionUser.id,
          orgId: chosenOrgId,
          approvedApiKeyId: minted.id,
          approvedAt: new Date(),
        })
        .where(
          and(
            eq(schema.cliAuthSessions.id, row.id),
            eq(schema.cliAuthSessions.status, 'pending'),
          ),
        );

      const actor = getActor(req);
      await recordEvent(ctx, {
        orgId: chosenOrgId,
        actorType: actor.actorType === 'system' ? 'user' : actor.actorType,
        actorId: actor.actorId ?? sessionUser.id,
        action: 'cli_auth.approved',
        metadata: {
          sessionId: row.id,
          keyId: minted.id,
          prefix: minted.prefix,
        },
      });

      reply.status(200);
      return { status: 'approved' as const, orgId: chosenOrgId };
    },
  );

  // ---------------- POST /v1/cli-auth/:sessionId/deny ----------------
  app.post<{ Params: { sessionId: string } }>(
    '/v1/cli-auth/:sessionId/deny',
    {
      schema: {
        summary: 'Deny a CLI auth session',
        description: 'Requires a signed-in session. Denies a pending session; idempotent for already-terminal sessions.',
        response: { 200: zodResponse(DenyResponse) },
      },
    },
    async (req, reply) => {
      const sessionUser = (req as SessionAuthenticatedRequest).sessionUser;
      if (!sessionUser) {
        throw new CarbonError({
          code: 'CARBON_UNAUTHENTICATED',
          message: 'Sign in to deny this CLI login',
          expose: true,
        });
      }
      const [row] = await ctx.db
        .select()
        .from(schema.cliAuthSessions)
        .where(eq(schema.cliAuthSessions.id, req.params.sessionId))
        .limit(1);
      if (!row) throw new NotFoundError('cli auth session', req.params.sessionId);
      if (row.status !== 'pending') {
        // Idempotent: denying an already-denied session is fine.
        reply.status(200);
        return { status: row.status };
      }
      await ctx.db
        .update(schema.cliAuthSessions)
        .set({ status: 'denied', userId: sessionUser.id })
        .where(
          and(
            eq(schema.cliAuthSessions.id, row.id),
            eq(schema.cliAuthSessions.status, 'pending'),
          ),
        );
      await secretStore.take(row.id);
      reply.status(200);
      return { status: 'denied' as const };
    },
  );
}

/**
 * Test-only no-op kept for backwards compatibility with the older test file
 * (the transient secret store used to be a module-scope Map; it now lives on
 * the registration closure and is reset by rebuilding the app instance).
 */
export function __resetCliAuthState(): void {
  /* no-op */
}
