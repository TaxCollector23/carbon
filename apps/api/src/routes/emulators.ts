import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

export async function registerEmulatorRoutes(app: FastifyInstance, _ctx: AppContext): Promise<void> {
  // The emulator control plane lives in a later milestone. For Phase One we
  // expose the shape so the dashboard and CLI can integrate against a
  // versioned URL, not a moving target.
  app.get('/v1/emulators', async () => ({ data: [] }));
  app.post('/v1/emulators', async (_req, reply) => {
    reply.status(202);
    return { status: 'queued' };
  });
}
