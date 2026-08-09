import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@carbon/database';
import { StorageKeys } from '@carbon/storage';
import type { AppContext } from '../context.js';
import { requireScope } from '../plugins/scopes.js';
import { getActor, recordEvent } from '../services/events.js';
import { recordAiQualityReport } from '../services/ai-quality.js';
import { recordUsage } from '../services/usage.js';
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
        if (project.orgId) {
          const actor = getActor(req);
          await recordEvent(ctx, {
            orgId: project.orgId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            action: 'ingest.enqueued',
            metadata: { projectSlug: project.slug, jobId: job.id, origin: body.origin ?? null },
          });
        }
        if (project.orgId) {
          await recordUsage(ctx, {
            orgId: project.orgId,
            kind: 'ingest',
            amount: 1,
            metadata: {
              projectSlug: project.slug,
              specKind: body.source.kind,
              mode: 'async',
            },
          });
        }
        reply.status(202);
        return { jobId: job.id, status: 'queued' };
      }

      const result = await ctx.ingestion.ingest({
        projectSlug: project.storageSlug,
        input: body.source as never,
        origin: body.origin,
        enrich: body.enrich,
        context: project.orgId ? { orgId: project.orgId } : undefined,
      });
      if (project.orgId) {
        const actor = getActor(req);
        await recordEvent(ctx, {
          orgId: project.orgId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: 'ingest.completed',
          metadata: {
            projectSlug: project.slug,
            irId: result.irId,
            graphId: result.graphId,
            endpoints: result.ir.endpoints.length,
            resources: result.ir.resources.length,
            origin: body.origin ?? null,
          },
        });
        await recordUsage(ctx, {
          orgId: project.orgId,
          kind: 'ingest',
          amount: 1,
          metadata: {
            projectSlug: project.slug,
            specKind: body.source.kind,
            mode: 'sync',
          },
        });
      }
      // Persist the judge verdicts to Postgres so the AI-quality view can
      // query historical scores without dereferencing storage blobs. Never
      // fails the ingest — a broken metrics pipeline must not turn a 201
      // into a 500.
      if (result.judge && project.orgId) {
        try {
          const [projectRow] = await ctx.db
            .select({ id: schema.projects.id })
            .from(schema.projects)
            .where(
              and(
                eq(schema.projects.orgId, project.orgId),
                eq(schema.projects.slug, project.slug),
              ),
            )
            .limit(1);
          if (projectRow) {
            await recordAiQualityReport(ctx, {
              projectId: projectRow.id,
              irKey: StorageKeys.ir(project.storageSlug, result.irId),
              verdicts: result.judge,
              threshold: ctx.judgeThreshold ?? 0.75,
            });
          }
        } catch (err) {
          ctx.logger.warn('ai_quality.persist_failed', {
            projectSlug: project.slug,
            irId: result.irId,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
      reply.status(201);
      return {
        irId: result.irId,
        graphId: result.graphId,
        api: result.ir.api,
        endpoints: result.ir.endpoints.length,
        resources: result.ir.resources.length,
        warnings: result.warnings,
        judge: result.judge,
      };
    },
  );

  // Shortcut: accept a raw Postman collection JSON body and route through
  // the postman parser adapter. Callers pass ?projectSlug=<slug>.
  app.post<{ Querystring: { projectSlug?: string; origin?: string } }>(
    '/v1/ingest/postman',
    {
      bodyLimit: 32 * 1024 * 1024,
      preHandler: requireScope('write'),
    },
    async (req, reply) => {
      const query = z
        .object({ projectSlug: ProjectSlug, origin: z.string().optional() })
        .parse(req.query);
      const project = await resolveProjectAccess(ctx, req, query.projectSlug);
      const result = await ctx.ingestion.ingest({
        projectSlug: project.storageSlug,
        input: { kind: 'json', content: req.body as unknown, hint: 'postman' } as never,
        origin: query.origin,
        enrich: false,
        context: project.orgId ? { orgId: project.orgId } : undefined,
      });
      if (project.orgId) {
        const actor = getActor(req);
        await recordEvent(ctx, {
          orgId: project.orgId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: 'ingest.completed',
          metadata: {
            projectSlug: project.slug,
            irId: result.irId,
            graphId: result.graphId,
            endpoints: result.ir.endpoints.length,
            resources: result.ir.resources.length,
            origin: query.origin ?? null,
            source: 'postman',
          },
        });
        await recordUsage(ctx, {
          orgId: project.orgId,
          kind: 'ingest',
          amount: 1,
          metadata: {
            projectSlug: project.slug,
            specKind: 'json',
            source: 'postman',
          },
        });
      }
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

