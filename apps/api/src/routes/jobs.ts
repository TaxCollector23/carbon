import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '@carbon/core';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { requireScope } from '../plugins/scopes.js';
import { zodResponse } from '../plugins/schema-helpers.js';

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
  })
  .passthrough();

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
    const { orgId: _orgId, ...publicJob } = job;
    return publicJob;
    },
  );
}
