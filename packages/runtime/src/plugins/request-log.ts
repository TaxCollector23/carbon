import type { RuntimePlugin } from '../runtime.js';

/**
 * Structured per-request logging. Attaches a start timestamp in an onRequest
 * hook and reports method / url / status / duration in onResponse. Uses the
 * runtime's own logger so log-level and redaction are consistent.
 */
export function requestLogPlugin(): RuntimePlugin {
  return {
    name: 'request-log',
    register(app, ctx) {
      app.addHook('onRequest', async (req) => {
        (req as { _startedAt?: number })._startedAt = Date.now();
      });
      app.addHook('onResponse', async (req, reply) => {
        const started = (req as { _startedAt?: number })._startedAt;
        const duration = started ? Date.now() - started : 0;
        ctx.logger.info('runtime.completed', {
          method: req.method,
          url: req.url,
          status: reply.statusCode,
          durationMs: duration,
        });
      });
    },
  };
}
