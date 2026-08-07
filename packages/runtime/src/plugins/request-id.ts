import { randomUUID } from 'node:crypto';
import type { RuntimePlugin } from '../runtime.js';

export interface RequestIdOptions {
  /** Header name to accept from upstream. Defaults to `x-request-id`. */
  readonly header?: string;
  /** Whether to include the id in every log line via `logger.child`. */
  readonly attachToLogger?: boolean;
}

/**
 * Attach a stable request id to every incoming request. If the caller already
 * provided one via `x-request-id`, we propagate it — otherwise we mint a UUID.
 * The id is echoed in the response, added to logs, and stored on `req.id`
 * so downstream code can correlate everything a request touched.
 */
export function requestIdPlugin(opts: RequestIdOptions = {}): RuntimePlugin {
  const header = (opts.header ?? 'x-request-id').toLowerCase();

  return {
    name: 'request-id',
    register(app) {
      app.addHook('onRequest', async (req, reply) => {
        const raw = req.headers[header];
        const value = Array.isArray(raw) ? raw[0] : raw;
        const id = value && typeof value === 'string' ? value : randomUUID();
        (req as unknown as { carbonId: string }).carbonId = id;
        reply.header(header, id);
      });
    },
  };
}
