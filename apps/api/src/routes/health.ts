import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

export async function registerHealthRoutes(app: FastifyInstance, _ctx: AppContext): Promise<void> {
  app.get('/health', async () => ({ ok: true, service: 'carbon-api', version: '0.1.0' }));
  app.get('/ready', async () => ({ ok: true }));
}
