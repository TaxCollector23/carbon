import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { requireScope } from '../plugins/scopes.js';
import { ProjectSlug, resolveProjectAccess } from './project-access.js';

const IngestBody = z.object({
  projectSlug: ProjectSlug,
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('json'), content: z.unknown(), hint: z.string().optional() }),
    z.object({ kind: z.literal('text'), content: z.string(), hint: z.string().optional() }),
  ]),
  origin: z.string().optional(),
  enrich: z.boolean().default(false),
  /**
   * When true, return 202 with a jobId and run ingestion in the background.
   * Recommended for large specs and hosts with short request timeouts.
   */
  async: z.boolean().default(false),
});

export async function registerIngestRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post(
    '/v1/ingest',
    {
      // Ingest accepts arbitrary spec content (OpenAPI/Postman/HAR/etc.),
      // some of which are legitimately large. Cap higher than the global
      // 10MB but well below anything that would starve the event loop.
      bodyLimit: 32 * 1024 * 1024,
      preHandler: requireScope('write'),
    },
    async (req, reply) => {
      const body = IngestBody.parse(req.body);
      const project = await resolveProjectAccess(ctx, req, body.projectSlug);

      if (body.async) {
        if (!ctx.jobs || !ctx.ingestionQueue) {
          reply.status(503).send({
            error: {
              code: 'CARBON_RUNTIME_UNAVAILABLE',
              message: 'Async ingestion requires REDIS_URL to be configured',
            },
          });
          return;
        }
        const job = await ctx.jobs.create('ingest', {
          orgId: project.orgId,
          projectSlug: project.slug,
          origin: body.origin,
        });
        // Hand off to BullMQ so the work survives a SIGTERM of this API
        // process and gets retried on failure. See packages/workers for the
        // shared queue/worker plumbing.
        await ctx.ingestionQueue.add('ingest', {
          statusJobId: job.id,
          orgId: project.orgId,
          projectSlug: project.storageSlug,
          publicSlug: project.slug,
          source: body.source,
          origin: body.origin,
          enrich: body.enrich,
        });
        reply.status(202);
        return { jobId: job.id, status: 'queued' };
      }

      const result = await ctx.ingestion.ingest({
        projectSlug: project.storageSlug,
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
    },
  );
}

