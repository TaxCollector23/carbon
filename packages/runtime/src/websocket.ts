import type { FastifyInstance } from 'fastify';
import type { JournalEntry } from '@carbon/state';
import websocketPlugin from '@fastify/websocket';
import type { RuntimeContext } from './runtime.js';

/**
 * Registers `GET /__carbon/state/stream` as a WebSocket upgrade. Each client
 * receives an initial `snapshot` frame with the current journal contents and
 * then a `mutation` frame for every subsequent mutation. A keepalive `ping`
 * frame is emitted every 20s to keep NAT / load balancer state fresh.
 */
export async function registerStateStream(
  app: FastifyInstance,
  ctx: RuntimeContext,
): Promise<void> {
  if (typeof ctx.state.subscribe !== 'function') {
    // Engine doesn't publish mutations — expose a 404 so callers get a
    // deterministic answer rather than a hanging upgrade.
    app.get('/__carbon/state/stream', async (_req, reply) => {
      reply.status(404);
      return { error: { code: 'CARBON_NOT_SUPPORTED', message: 'engine has no live feed' } };
    });
    return;
  }

  await app.register(websocketPlugin);

  app.get('/__carbon/state/stream', { websocket: true }, (socket, _req) => {
    const send = (payload: unknown): void => {
      // socket.readyState is `WebSocket.OPEN` (1) when writable.
      if (socket.readyState !== 1) return;
      try {
        socket.send(JSON.stringify(payload));
      } catch (err) {
        ctx.logger.debug('runtime.ws.send_failed', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };

    const initial: readonly JournalEntry[] =
      typeof ctx.state.history === 'function' ? ctx.state.history() : [];

    send({ type: 'snapshot', at: Date.now(), entries: initial });

    const unsubscribe = ctx.state.subscribe!((entry) => {
      send({ type: 'mutation', entry });
    });

    // Keepalive — every 20s send a lightweight app-level ping frame. We use
    // JSON rather than the WS-protocol ping so browsers can observe it too.
    const keepalive = setInterval(() => {
      send({ type: 'ping', at: Date.now() });
    }, 20_000);
    // Do not keep the event loop alive just for the keepalive timer.
    if (typeof keepalive.unref === 'function') keepalive.unref();

    const cleanup = (): void => {
      clearInterval(keepalive);
      unsubscribe();
    };

    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });
}
