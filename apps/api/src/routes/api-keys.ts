import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, isNull } from 'drizzle-orm';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import { mintApiKey } from '../services/api-keys.js';

const CreateBody = z.object({
  orgId: z.string().min(1),
  name: z.string().min(1).max(80),
});

export async function registerApiKeyRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/api-keys', async () => {
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
      .where(isNull(schema.apiKeys.revokedAt));
    return { data: rows };
  });

  app.post('/v1/api-keys', async (req, reply) => {
    const body = CreateBody.parse(req.body);
    const key = await mintApiKey(ctx, body);
    reply.status(201);
    return key;
  });

  app.delete<{ Params: { id: string } }>('/v1/api-keys/:id', async (req, reply) => {
    await ctx.db
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(schema.apiKeys.id, req.params.id));
    reply.status(204);
  });
}
