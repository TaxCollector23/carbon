import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CarbonError, NotFoundError } from '@carbon/core';
import { isIngestJobPayload } from '@carbon/workers';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { requireScope } from '../plugins/scopes.js';
import { zodQuery, zodResponse } from '../plugins/schema-helpers.js';
import { resolveCallerOrg } from '../plugins/caller-org.js';
import type { JobRecord } from '../services/jobs.js';

const JobResponse = z
  .object({
    id: z.string(),
    kind: z.string(),
    status: z.string(),
    progress: z.number().nullable().optional(),
    result: z.unknown().optional(),
    error: z.string().nullable().optional(),
    createdAt: z.union([z.string(), z.number()]).optional(),
    updatedAt: z.union([z.string(), z.number()]).optional(),
    attempts: z.number().optional(),
    maxAttempts: z.number().optional(),
    nextAttemptAt: z.number().nullable().optional(),
    deadLetter: z.boolean().optional(),
  })
  .passthrough();

const JobListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
  status: z
    .enum(['queued', 'running', 'succeeded', 'failed', 'needs_review', 'deadLetter'])
    .optional(),
});

const JobListResponse = z.object({
  data: z.array(JobResponse),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

function publicJob(job: JobRecord): Omit<JobRecord, 'orgId' | 'meta'> {
  const { orgId: _orgId, meta: _meta, ...rest } = job;
  return rest;
}

export async function registerJobRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/v1/jobs/:id',
    {
      preHandler: requireScope('read'),
      schema: {
        summary: 'Get async job status',
        description:
          'Look up the status of an async job (e.g. background ingestion). Callers only see jobs on their own org; unknown or cross-org ids return 404.',
        params: zodResponse(z.object({ id: z.string() })),
        response: { 200: zodResponse(JobResponse) },
      },
    },
    async (req) => {
      if (!ctx.jobs) throw new NotFoundError('job', req.params.id);
      const job = await ctx.jobs.get(req.params.id);
      const orgId = (req as AuthenticatedRequest).apiKey?.orgId;
      if (orgId && job.orgId !== orgId) throw new NotFoundError('job', req.params.id);
      return publicJob(job);
    },
  );

  app.get<{
    Querystring: { limit?: number; cursor?: string; status?: string };
  }>(
    '/v1/jobs',
    {
      preHandler: requireScope('admin'),
      schema: {
        summary: 'List recent async jobs',
        description:
          "Enumerate the operator queue. Scoped to the caller's org. Supports `status` filter (including `deadLetter`) and offset pagination via `cursor`.",
        querystring: zodQuery(JobListQuery),
        response: { 200: zodResponse(JobListResponse) },
      },
    },
    async (req) => {
      if (!ctx.jobs) return { data: [], nextCursor: null, hasMore: false };
      const query = JobListQuery.parse(req.query);
      const orgId = resolveCallerOrg(req, { mode: 'return-empty' });
      if (!orgId) return { data: [], nextCursor: null, hasMore: false };
      const page = await ctx.jobs.list({
        orgId,
        status: query.status as never,
        limit: query.limit,
        cursor: query.cursor,
      });
      return {
        data: page.data.map(publicJob),
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/jobs/:id/retry',
    {
      preHandler: requireScope('admin'),
      schema: {
        summary: 'Retry a failed async job',
        description:
          'Re-queue a `failed` (non-dead-letter) job. Idempotent on `succeeded`/`running`. Returns 409 CARBON_STATE_VIOLATION when the job is dead-lettered.',
        params: zodResponse(z.object({ id: z.string() })),
        response: { 200: zodResponse(JobResponse) },
      },
    },
    async (req) => {
      if (!ctx.jobs) throw new NotFoundError('job', req.params.id);
      const existing = await ctx.jobs.get(req.params.id);
      const orgId = (req as AuthenticatedRequest).apiKey?.orgId;
      if (orgId && existing.orgId !== orgId) throw new NotFoundError('job', req.params.id);
      if (existing.deadLetter || existing.status === 'succeeded' || existing.status === 'running') {
        return publicJob(await ctx.jobs.retry(req.params.id));
      }
      const payload = existing.meta?.payload;
      if (!isIngestJobPayload(payload)) {
        throw new CarbonError({
          code: 'CARBON_STATE_VIOLATION',
          message: 'Job cannot be retried because its ingest payload was not recorded',
          details: { id: existing.id, kind: existing.kind },
          expose: true,
        });
      }
      if (!ctx.ingestionQueue) {
        throw new CarbonError({
          code: 'CARBON_RUNTIME_UNAVAILABLE',
          message: 'Job retry requires the ingestion queue to be configured',
          details: { id: existing.id },
          expose: true,
        });
      }
      const updated = await ctx.jobs.retry(req.params.id);
      try {
        await ctx.ingestionQueue.add('ingest', payload, {
          jobId: `${existing.id}:manual:${Date.now()}`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.logger.warn('job.retry_enqueue_failed', { id: existing.id, message });
        try {
          await ctx.jobs.update(existing.id, {
            status: 'failed',
            error: 'Failed to enqueue retry',
          });
        } catch (updateErr) {
          ctx.logger.warn('job.retry_status_update_failed', {
            id: existing.id,
            message: updateErr instanceof Error ? updateErr.message : String(updateErr),
          });
        }
        throw new CarbonError({
          code: 'CARBON_RUNTIME_UNAVAILABLE',
          message: 'Job retry is temporarily unavailable',
          details: { id: existing.id },
          expose: true,
        });
      }
      return publicJob(updated);
    },
  );
}
