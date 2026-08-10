import Fastify, { type FastifyInstance } from 'fastify';
import { NoopLogger, isCarbonError, type Logger } from '@carbon/core';
import type { BehaviorGraph, IntermediateRepresentation } from '@carbon/types';
import type { StateEngine } from '@carbon/state';
import type { ConsistencyMode } from '@carbon/graph';
import { registerGraphRoutes } from './router.js';
import { registerStateStream } from './websocket.js';
import { toHttpError } from './errors.js';

/**
 * The Runtime is the Fastify shell that hosts a compiled behavior graph and
 * state engine as a live HTTP API. It is intentionally thin — all business
 * logic lives in @carbon/graph and @carbon/state so the runtime can be swapped
 * (Fastify → uWebSockets, Bun, Cloudflare Workers) without touching semantics.
 */
export interface RuntimeOptions {
  readonly ir: IntermediateRepresentation;
  readonly graph: BehaviorGraph;
  readonly state: StateEngine;
  readonly logger?: Logger;
  readonly plugins?: readonly RuntimePlugin[];
  /**
   * How strictly the runtime enforces referential integrity. `strict` (the
   * default) drops rows whose foreign keys don't resolve; `loose` returns
   * them as-is so callers can inspect the drift.
   */
  readonly consistency?: ConsistencyMode;
}

/**
 * Runtime plugins are the extension point for auth, rate limits, custom
 * headers, webhooks — anything cross-cutting. They receive the Fastify
 * instance and the runtime context and register whatever they need.
 */
export interface RuntimePlugin {
  readonly name: string;
  register(app: FastifyInstance, ctx: RuntimeContext): Promise<void> | void;
}

export interface RuntimeContext {
  readonly ir: IntermediateRepresentation;
  readonly graph: BehaviorGraph;
  readonly state: StateEngine;
  readonly logger: Logger;
  readonly consistency: ConsistencyMode;
}

export interface Runtime {
  readonly url: string;
  listen(port: number, host?: string): Promise<string>;
  close(): Promise<void>;
  readonly app: FastifyInstance;
  readonly ctx: RuntimeContext;
}

export async function createRuntime(opts: RuntimeOptions): Promise<Runtime> {
  const logger = opts.logger ?? NoopLogger;
  const app = Fastify({
    logger: false, // we use our own structured logger; fastify's is off
    disableRequestLogging: true,
    ajv: { customOptions: { removeAdditional: false, useDefaults: true } },
  });

  const ctx: RuntimeContext = {
    ir: opts.ir,
    graph: opts.graph,
    state: opts.state,
    logger,
    consistency: opts.consistency ?? 'strict',
  };

  app.addHook('onRequest', async (req) => {
    logger.debug('runtime.request', { method: req.method, url: req.url });
  });

  app.setErrorHandler((err, _req, reply) => {
    if (isCarbonError(err)) {
      const mapped = toHttpError(err);
      reply.status(mapped.status).send(mapped.body);
      return;
    }
    logger.error('runtime.internal_error', {
      message: err instanceof Error ? err.message : String(err),
    });
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: 'Internal error' } });
  });

  for (const plugin of opts.plugins ?? []) {
    await plugin.register(app, ctx);
  }

  await registerStateStream(app, ctx);
  await registerGraphRoutes(app, ctx);

  let boundUrl = '';
  return {
    get url() {
      return boundUrl;
    },
    app,
    ctx,
    async listen(port: number, host = '127.0.0.1'): Promise<string> {
      boundUrl = await app.listen({ port, host });
      logger.info('runtime.listening', { url: boundUrl });
      return boundUrl;
    },
    async close(): Promise<void> {
      await app.close();
      logger.info('runtime.closed');
    },
  };
}
