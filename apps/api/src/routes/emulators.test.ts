import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { registerEmulatorRoutes } from './emulators.js';

interface CreateCall {
  host?: string;
}

function makeCtx(opts: { allowedHosts?: readonly string[]; calls: CreateCall[] }): AppContext {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => [{ orgId: 'org_1', slug: 'acme' }],
  };
  return {
    logger: NoopLogger,
    db: { select: () => chain } as unknown as AppContext['db'],
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {
      list: () => [],
      create: async (input: CreateCall) => {
        opts.calls.push(input);
        return {
          id: 'emu_1',
          projectSlug: 'org_1/acme',
          irId: 'ir_1',
          url: `http://${input.host}:4001`,
          startedAt: 0,
          status: 'running',
        };
      },
    } as unknown as AppContext['emulators'],
    emulatorAllowedHosts: opts.allowedHosts,
  };
}

async function build(opts: { allowedHosts?: readonly string[]; calls: CreateCall[] }) {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', message: err.message } });
      return;
    }
    if (isCarbonError(err)) {
      const status = err.code === 'CARBON_INVALID_INPUT' ? 400 : 500;
      reply.status(status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply.status(500).send({
      error: { code: 'CARBON_INTERNAL', message: err instanceof Error ? err.message : 'error' },
    });
  });
  app.addHook('onRequest', async (req) => {
    (req as AuthenticatedRequest).apiKey = {
      id: 'key_1',
      orgId: 'org_1',
      prefix: 'aa11bb22cc33',
    };
  });
  await registerEmulatorRoutes(app, makeCtx(opts));
  await app.ready();
  return app;
}

describe('emulator routes host allow-list', () => {
  it('rejects binding to 0.0.0.0 by default', async () => {
    const calls: CreateCall[] = [];
    const app = await build({ calls });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/emulators',
      payload: { projectSlug: 'acme', irId: 'ir_1', host: '0.0.0.0' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CARBON_INVALID_INPUT');
    expect(calls).toEqual([]);
  });

  it('defaults host to 127.0.0.1 when the caller omits it', async () => {
    const calls: CreateCall[] = [];
    const app = await build({ calls });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/emulators',
      payload: { projectSlug: 'acme', irId: 'ir_1' },
    });
    expect(res.statusCode).toBe(201);
    expect(calls[0]?.host).toBe('127.0.0.1');
  });

  it('lets operators opt into 0.0.0.0 via CARBON_EMULATOR_ALLOWED_HOSTS', async () => {
    const calls: CreateCall[] = [];
    const app = await build({
      calls,
      allowedHosts: ['127.0.0.1', 'localhost', '0.0.0.0'],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/emulators',
      payload: { projectSlug: 'acme', irId: 'ir_1', host: '0.0.0.0' },
    });
    expect(res.statusCode).toBe(201);
    expect(calls[0]?.host).toBe('0.0.0.0');
  });
});
