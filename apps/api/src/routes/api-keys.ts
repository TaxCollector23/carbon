import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { CarbonError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { mintApiKey } from '../services/api-keys.js';

const CreateBody = z.object({
  orgId: z.string().min(1).optional(),
  name: z.string().min(1).max(80),
});

export async function registerApiKeyRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/api-keys', async (req) => {
    const orgId = requestOrgId(req);
    const where = orgId
      ? and(eq(schema.apiKeys.orgId, orgId), isNull(schema.apiKeys.revokedAt))
      : isNull(schema.apiKeys.revokedAt);
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
      .where(where);
    return { data: rows };
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
    const where = orgId
      ? and(eq(schema.apiKeys.id, req.params.id), eq(schema.apiKeys.orgId, orgId))
      : eq(schema.apiKeys.id, req.params.id);
    await ctx.db.update(schema.apiKeys).set({ revokedAt: new Date() }).where(where);
    reply.status(204);
  });
}

function requestOrgId(req: unknown, fallback?: string): string | undefined {
  return (req as AuthenticatedRequest).apiKey?.orgId ?? fallback;
}
