import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';

const IngestBody = z.object({
  projectSlug: z.string().min(1),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('json'), content: z.unknown(), hint: z.string().optional() }),
    z.object({ kind: z.literal('text'), content: z.string(), hint: z.string().optional() }),
  ]),
  origin: z.string().optional(),
  enrich: z.boolean().default(false),
});

export async function registerIngestRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/v1/ingest', async (req, reply) => {
    const body = IngestBody.parse(req.body);
    const result = await ctx.ingestion.ingest({
      projectSlug: body.projectSlug,
      input: body.source as never,
      origin: body.origin,
      enrich: body.enrich,
    });
    reply.status(201);
    return {
      irId: result.irId,
      graphId: result.graphId,
      api: result.ir.api,
      endpoints: result.ir.endpoints.length,
      resources: result.ir.resources.length,
      warnings: result.warnings,
    };
  });
}
