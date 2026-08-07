import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '@carbon/core';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';

export async function registerJobRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Params: { id: string } }>('/v1/jobs/:id', async (req) => {
    if (!ctx.jobs) throw new NotFoundError('job', req.params.id);
    const job = await ctx.jobs.get(req.params.id);
    const orgId = (req as AuthenticatedRequest).apiKey?.orgId;
    if (orgId && job.orgId !== orgId) throw new NotFoundError('job', req.params.id);
    const { orgId: _orgId, ...publicJob } = job;
    return publicJob;
  });
}
