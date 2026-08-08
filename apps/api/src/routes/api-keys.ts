import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { CarbonError, NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { mintApiKey } from '../services/api-keys.js';

const CreateBody = z.object({
  orgId: z.string().min(1).optional(),
  name: z.string().min(1).max(80),
});

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function registerApiKeyRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/api-keys', async (req) => {
    const { limit } = ListQuery.parse(req.query);
    const orgId = requestOrgId(req);
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
        lastUsedAt: schema.apiKeys.lastUsedAt,
        createdAt: schema.apiKeys.createdAt,
      })
      .from(schema.apiKeys)
      .where(where)
      .orderBy(desc(schema.apiKeys.createdAt))
      .limit(limit);
    return { data: rows, limit };
  });

  app.post('/v1/api-keys', async (req, reply) => {
    const body = CreateBody.parse(req.body);
    const orgId = requestOrgId(req, body.orgId);
    if (!orgId) {
      throw new CarbonError({
        code: 'CARBON_INVALID_INPUT',
        message: 'orgId is required when API auth is disabled',
        expose: true,
      });
    }
    const key = await mintApiKey(ctx, { orgId, name: body.name });
    reply.status(201);
    return key;
  });

  app.delete<{ Params: { id: string } }>('/v1/api-keys/:id', async (req, reply) => {
    const orgId = requestOrgId(req);
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
    reply.status(204);
  });
}

function requestOrgId(req: unknown, fallback?: string): string | undefined {
  return (req as AuthenticatedRequest).apiKey?.orgId ?? fallback;
}
