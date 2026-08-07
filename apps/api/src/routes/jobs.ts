import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '@carbon/core';
import type { AppContext } from '../context.js';

export async function registerJobRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Params: { id: string } }>('/v1/jobs/:id', async (req) => {
    if (!ctx.jobs) throw new NotFoundError('job', req.params.id);
    return ctx.jobs.get(req.params.id);
  });
}
