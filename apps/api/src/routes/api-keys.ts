import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { CarbonError, NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import { resolveCallerOrg } from '../plugins/caller-org.js';
import { requireScope } from '../plugins/scopes.js';
import {
  zodBody,
  zodQuery,
  zodResponse,
  zodResponseWithExample,
} from '../plugins/schema-helpers.js';

const ApiKeySummary = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  projectIds: z.array(z.string()).nullable(),
  lastUsedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  rotatedFromId: z.string().nullable(),
});
const ApiKeyListResponse = z.object({
  data: z.array(ApiKeySummary),
  limit: z.number().int(),
});
const MintedApiKey = z.object({
  id: z.string(),
  secret: z.string().optional(),
  presented: z.string().optional(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  projectIds: z.array(z.string()).nullable(),
  expiresAt: z.string().datetime().nullable(),
  rotatedFromId: z.string().nullable().optional(),
});
const RotateResponse = z.object({
  id: z.string(),
  secret: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  projectIds: z.array(z.string()).nullable(),
  expiresAt: z.string().datetime().nullable(),
  rotatedFromId: z.string().nullable(),
  sourceId: z.string(),
  sourceExpiresAt: z.string().datetime(),
});
import { mintApiKey, rotateApiKey } from '../services/api-keys.js';
import { getActor, recordEvent } from '../services/events.js';

const MAX_EXPIRES_IN_SECONDS = 90 * 24 * 60 * 60; // 90 days
const MAX_GRACE_SECONDS = 7 * 24 * 60 * 60; // 7 days

const ScopeEnum = z.enum(['read', 'write', 'admin']);

const CreateBody = z.object({
  orgId: z.string().min(1).optional(),
  name: z.string().min(1).max(80),
  // Default preserves the pre-RBAC behavior for callers that haven't started
  // scoping keys yet. Real deploys should mint `read`/`write` and reserve
  // `admin` for the bootstrap key.
  scopes: z.array(ScopeEnum).min(1).default(['admin']),
  // null (or omitted) means "all projects in org". A non-empty list pins the
  // key to those project ids only.
  projectIds: z.array(z.string().min(1)).nullable().default(null),
  /**
   * When set, the minted key auto-expires after this many seconds. Use for
   * CI/short-lived credentials. 60s minimum, 90 days maximum.
   */
  expiresInSeconds: z.number().int().min(60).max(MAX_EXPIRES_IN_SECONDS).optional(),
});

const RotateBody = z.object({
  graceSeconds: z.number().int().min(60).max(MAX_GRACE_SECONDS).default(3600),
  scopes: z.array(ScopeEnum).min(1).optional(),
  projectIds: z.array(z.string().min(1)).nullable().optional(),
});

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function registerApiKeyRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // Every /v1/api-keys route is admin — key management is the most sensitive
  // surface on the control plane and must never be reachable from a
  // `write`-scoped key.
  app.get(
    '/v1/api-keys',
    {
      preHandler: requireScope('admin'),
      schema: {
        summary: 'List API keys',
        description:
          "Return every non-revoked API key on the caller's org. Secrets and hashes are never returned; only the id/prefix/scopes/metadata.",
        querystring: zodQuery(ListQuery),
        response: { 200: zodResponse(ApiKeyListResponse) },
      },
    },
    async (req) => {
      const { limit } = ListQuery.parse(req.query);
      const orgId = resolveCallerOrg(req, { mode: 'optional' });
      const where = orgId
        ? and(eq(schema.apiKeys.orgId, orgId), isNull(schema.apiKeys.revokedAt))
        : isNull(schema.apiKeys.revokedAt);
      // Never select `hash` — the column holds the only server-side material an
      // attacker would need to verify a guessed secret offline.
      const rows = await ctx.db
        .select({
          id: schema.apiKeys.id,
          orgId: schema.apiKeys.orgId,
          name: schema.apiKeys.name,
          prefix: schema.apiKeys.prefix,
          scopes: schema.apiKeys.scopes,
          projectIds: schema.apiKeys.projectIds,
          lastUsedAt: schema.apiKeys.lastUsedAt,
          createdAt: schema.apiKeys.createdAt,
          expiresAt: schema.apiKeys.expiresAt,
          rotatedFromId: schema.apiKeys.rotatedFromId,
        })
        .from(schema.apiKeys)
        .where(where)
        .orderBy(desc(schema.apiKeys.createdAt))
        .limit(limit);
      return { data: rows, limit };
    },
  );

  app.post(
    '/v1/api-keys',
    {
      preHandler: requireScope('admin'),
      schema: {
        summary: 'Mint an API key',
        description:
          'Mint a new API key. The presented secret is returned exactly once — store it immediately. ' +
          'Only the hashed form is persisted server-side.',
        body: zodBody(CreateBody),
        response: {
          201: zodResponseWithExample(MintedApiKey, {
            id: 'akid_01HXK5H7Q9C0R3Q1S8V6M4WJZK',
            // Presented exactly once — copy immediately, only a bcrypt hash is
            // retained server-side.
            secret: '<redacted-secret>',
            presented: 'ck_live_<prefix>.<secret>',
            prefix: 'abcdef012345',
            scopes: ['read', 'write'],
            projectIds: null,
            expiresAt: null,
            rotatedFromId: null,
          }),
        },
      },
    },
    async (req, reply) => {
      const body = CreateBody.parse(req.body);
      const orgId = resolveCallerOrg(req, { queryOrg: body.orgId, mode: 'optional' });
      if (!orgId) {
        throw new CarbonError({
          code: 'CARBON_INVALID_INPUT',
          message: 'orgId is required when API auth is disabled',
          expose: true,
        });
      }
      // Prevent a project-pinned key from being minted against ids the caller's
      // org does not own — otherwise a subtle typo silently produces a key that
      // is scoped to nothing at all, and a malicious caller could probe for
      // valid project ids across orgs.
      if (body.projectIds && body.projectIds.length > 0) {
        const rows = await ctx.db
          .select({ id: schema.projects.id })
          .from(schema.projects)
          .where(
            and(eq(schema.projects.orgId, orgId), inArray(schema.projects.id, body.projectIds)),
          );
        const owned = new Set(rows.map((r) => r.id));
        const missing = body.projectIds.filter((id) => !owned.has(id));
        if (missing.length > 0) {
          throw new CarbonError({
            code: 'CARBON_INVALID_INPUT',
            message: 'projectIds contains ids not owned by this org',
            details: { missing },
            expose: true,
          });
        }
      }
      const expiresAt = body.expiresInSeconds
        ? new Date(Date.now() + body.expiresInSeconds * 1000)
        : null;
      const key = await mintApiKey(ctx, {
        orgId,
        name: body.name,
        scopes: body.scopes,
        projectIds: body.projectIds,
        expiresAt,
      });
      const actor = getActor(req);
      await recordEvent(ctx, {
        orgId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'api_key.created',
        metadata: {
          keyId: key.id,
          prefix: key.prefix,
          name: body.name,
          scopes: body.scopes,
          projectIds: body.projectIds,
          expiresAt: expiresAt ? expiresAt.toISOString() : null,
        },
      });
      reply.status(201);
      return { ...key, secret: key.presented };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/api-keys/:id/rotate',
    {
      preHandler: requireScope('admin'),
      schema: {
        summary: 'Rotate an API key',
        description:
          'Mint a replacement key and mark the source key to expire after `graceSeconds`. The new secret is returned exactly once.',
        body: zodBody(RotateBody),
        response: { 201: zodResponse(RotateResponse) },
      },
    },
    async (req, reply) => {
      const body = RotateBody.parse(req.body ?? {});
      const orgId = resolveCallerOrg(req, { mode: 'optional' });
      if (!orgId) {
        throw new CarbonError({
          code: 'CARBON_INVALID_INPUT',
          message: 'orgId is required when API auth is disabled',
          expose: true,
        });
      }
      // Same ownership check as create: reject project ids the caller's org
      // does not own before touching the source key.
      if (body.projectIds && body.projectIds.length > 0) {
        const rows = await ctx.db
          .select({ id: schema.projects.id })
          .from(schema.projects)
          .where(
            and(eq(schema.projects.orgId, orgId), inArray(schema.projects.id, body.projectIds)),
          );
        const owned = new Set(rows.map((r) => r.id));
        const missing = body.projectIds.filter((id) => !owned.has(id));
        if (missing.length > 0) {
          throw new CarbonError({
            code: 'CARBON_INVALID_INPUT',
            message: 'projectIds contains ids not owned by this org',
            details: { missing },
            expose: true,
          });
        }
      }
      const { minted, source } = await rotateApiKey(ctx, {
        sourceId: req.params.id,
        orgId,
        graceSeconds: body.graceSeconds,
        scopes: body.scopes,
        projectIds: body.projectIds,
      });
      const actor = getActor(req);
      await recordEvent(ctx, {
        orgId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'api_key.rotated',
        metadata: {
          sourceKeyId: source.id,
          newKeyId: minted.id,
          graceSeconds: body.graceSeconds,
          sourceExpiresAt: source.expiresAt.toISOString(),
        },
      });
      reply.status(201);
      return {
        id: minted.id,
        secret: minted.presented,
        prefix: minted.prefix,
        scopes: minted.scopes,
        projectIds: minted.projectIds,
        expiresAt: minted.expiresAt,
        rotatedFromId: minted.rotatedFromId,
        sourceId: source.id,
        sourceExpiresAt: source.expiresAt,
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/v1/api-keys/:id',
    { preHandler: requireScope('admin') },
    async (req, reply) => {
      const orgId = resolveCallerOrg(req, { mode: 'optional' });
      const scope = [eq(schema.apiKeys.id, req.params.id)];
      if (orgId) scope.push(eq(schema.apiKeys.orgId, orgId));
      // Skipping already-revoked rows keeps revokedAt as the moment of the first
      // revocation rather than the last DELETE, and makes the 404 below mean
      // "nothing left to revoke".
      scope.push(isNull(schema.apiKeys.revokedAt));

      const revoked = await ctx.db
        .update(schema.apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(...scope))
        .returning({ id: schema.apiKeys.id });

      // Previously this returned 204 whether or not anything matched, so a typo'd
      // id or another org's key both read as a successful revocation.
      if (revoked.length === 0) throw new NotFoundError('api key', req.params.id);
      if (orgId) {
        const actor = getActor(req);
        await recordEvent(ctx, {
          orgId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: 'api_key.revoked',
          metadata: { keyId: req.params.id },
        });
      }
      reply.status(204);
    },
  );
}
