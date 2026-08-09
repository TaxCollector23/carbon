import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { registerMeRoutes } from './me.js';

function makeCtx(): AppContext {
  let lastTable: unknown = null;
  const db = {
    select: () => ({
      from: (t: unknown) => {
        lastTable = t;
        return {
          where: () => ({
            limit: async () => {
              if (lastTable === schema.organizations) {
                return [{ id: 'org_1', name: 'Acme', slug: 'acme' }];
              }
              if (lastTable === schema.subscriptions) {
                return [{ plan: 'team', status: 'active' }];
              }
              return [];
            },
          }),
        };
      },
    }),
  } as unknown as AppContext['db'];
  return {
    logger: NoopLogger,
    db,
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

async function build(withApiKey: boolean) {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (isCarbonError(err)) {
      const status = err.code === 'CARBON_UNAUTHENTICATED' ? 401 : 500;
      reply.status(status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
  });
  if (withApiKey) {
    app.addHook('onRequest', async (req) => {
      (req as AuthenticatedRequest).apiKey = {
        id: 'key_test',
        orgId: 'org_1',
        prefix: 'aa11bb22cc33',
        scopes: ['read', 'write'],
        projectIds: null,
        expiresAt: null,
      };
    });
  }
  await registerMeRoutes(app, makeCtx());
  await app.ready();
  return app;
}

describe('me route', () => {
  it('with an API key attached: returns { user:null, key, org, plan }', async () => {
    const app = await build(true);
    const res = await app.inject({ method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      user: unknown;
      key: { prefix: string; scopes: string[] };
      org: { id: string; slug: string };
      plan: string;
    };
    expect(body.user).toBeNull();
    expect(body.key.prefix).toBe('aa11bb22cc33');
    expect(body.key.scopes).toEqual(['read', 'write']);
    expect(body.org.id).toBe('org_1');
    expect(body.plan).toBe('team');
  });

  it('with no auth at all: returns 401 CARBON_UNAUTHENTICATED', async () => {
    const app = await build(false);
    const res = await app.inject({ method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('CARBON_UNAUTHENTICATED');
  });
});
