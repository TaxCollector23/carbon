import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
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
  app.post('/v1/ingest', async (req, reply) => {
    const body = IngestBody.parse(req.body);
    const project = await resolveProjectAccess(ctx, req, body.projectSlug);

    if (body.async) {
      if (!ctx.jobs) {
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
      // Fire and forget — the worker layer updates the job as it progresses.
      void runIngestJob(ctx, job.id, { ...body, projectSlug: project.storageSlug });
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
  });
}

async function runIngestJob(
  ctx: AppContext,
  jobId: string,
  body: z.infer<typeof IngestBody>,
): Promise<void> {
  if (!ctx.jobs) return;
  await ctx.jobs.update(jobId, { status: 'running' });
  try {
    const result = await ctx.ingestion.ingest({
      projectSlug: body.projectSlug,
      input: body.source as never,
      origin: body.origin,
      enrich: body.enrich,
    });
    await ctx.jobs.update(jobId, {
      status: 'succeeded',
      result: {
        irId: result.irId,
        graphId: result.graphId,
        api: result.ir.api,
        endpoints: result.ir.endpoints.length,
        resources: result.ir.resources.length,
        warnings: result.warnings,
      },
    });
  } catch (err) {
    ctx.logger.error('ingest.job_failed', { jobId, message: (err as Error).message });
    await ctx.jobs.update(jobId, {
      status: 'failed',
      error: (err as Error).message,
    });
  }
}
