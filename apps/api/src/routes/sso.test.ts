import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { registerSsoRoutes } from './sso.js';

interface OrgRow {
  id: string;
  isEnterprise: boolean;
  settings: { ssoProviders?: Array<Record<string, unknown>> } & Record<string, unknown>;
}

interface Store {
  orgs: OrgRow[];
  events: Array<{ orgId: string; action: string }>;
}

function makeDb(store: Store): AppContext['db'] {
  let lastTable: unknown = null;
  const chain = (): any => {
    const c: any = {
      from: (t: unknown) => {
        lastTable = t;
        return c;
      },
      where: () => c,
      limit: async () => {
        if (lastTable === schema.organizations) return [...store.orgs];
        return [];
      },
    };
    return c;
  };
  return {
    select: () => chain(),
    insert: (table: unknown) => ({
      values: async (v: any) => {
        if (table === schema.events) {
          store.events.push({ orgId: v.orgId, action: v.action });
        }
      },
    }),
    update: (table: unknown) => {
      let patch: any = {};
      const upd: any = {
        set: (p: any) => {
          patch = p;
          return upd;
        },
        where: async () => {
          if (table === schema.organizations) {
            for (const org of store.orgs) {
              Object.assign(org, patch);
            }
          }
        },
      };
      return upd;
    },
  } as unknown as AppContext['db'];
}

function makeCtx(store: Store): AppContext {
  return {
    logger: NoopLogger,
    db: makeDb(store),
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

async function build(store: Store, orgId: string): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', message: err.message } });
      return;
    }
    if (isCarbonError(err)) {
      const status =
        err.code === 'CARBON_FORBIDDEN'
          ? 403
          : err.code === 'CARBON_NOT_FOUND'
            ? 404
            : err.code === 'CARBON_INVALID_INPUT'
              ? 400
              : 500;
      reply.status(status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
  });
  app.addHook('onRequest', async (req) => {
    (req as AuthenticatedRequest).apiKey = {
      id: 'k',
      orgId,
      prefix: 'aa11bb22cc33',
      scopes: ['admin'],
      projectIds: null,
      expiresAt: null,
    };
  });
  await registerSsoRoutes(app, makeCtx(store));
  await app.ready();
  return app;
}

const samlPayload = {
  type: 'saml',
  name: 'Corp SAML',
  entityId: 'urn:example:idp',
  ssoUrl: 'https://idp.example.com/sso',
  certificate: '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----',
};

describe('sso routes', () => {
  it('POST /v1/sso/providers → 403 on a non-enterprise org', async () => {
    const store: Store = {
      orgs: [{ id: 'org_1', isEnterprise: false, settings: {} }],
      events: [],
    };
    const app = await build(store, 'org_1');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sso/providers',
      payload: samlPayload,
    });
    expect(res.statusCode).toBe(403);
    expect(store.orgs[0]!.settings.ssoProviders).toBeUndefined();
  });

  it('enterprise org can create, list, and delete providers', async () => {
    const store: Store = {
      orgs: [{ id: 'org_1', isEnterprise: true, settings: {} }],
      events: [],
    };
    const app = await build(store, 'org_1');

    const create = await app.inject({
      method: 'POST',
      url: '/v1/sso/providers',
      payload: samlPayload,
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as { id: string; type: string };
    expect(created.type).toBe('saml');
    expect(store.orgs[0]!.settings.ssoProviders).toHaveLength(1);
    expect(store.events.some((e) => e.action === 'sso_provider.created')).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/v1/sso/providers' });
    expect(list.statusCode).toBe(200);
    const listed = list.json() as { data: unknown[] };
    expect(listed.data).toHaveLength(1);

    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/sso/providers/${created.id}`,
    });
    expect(del.statusCode).toBe(204);
    expect(store.orgs[0]!.settings.ssoProviders).toHaveLength(0);
    expect(store.events.some((e) => e.action === 'sso_provider.deleted')).toBe(true);
  });

  it('OIDC provider list responses do not include clientSecret', async () => {
    const store: Store = {
      orgs: [{ id: 'org_1', isEnterprise: true, settings: {} }],
      events: [],
    };
    const app = await build(store, 'org_1');
    const create = await app.inject({
      method: 'POST',
      url: '/v1/sso/providers',
      payload: {
        type: 'oidc',
        name: 'Corp OIDC',
        issuer: 'https://idp.example.com',
        clientId: 'abc',
        clientSecret: 'shhh',
      },
    });
    expect(create.statusCode).toBe(201);
    const body = create.json() as { config: Record<string, unknown> };
    expect(body.config.clientId).toBe('abc');
    expect(body.config.clientSecret).toBeUndefined();
    // But the raw stored copy retains the secret for a future SSO enforcer.
    const stored = store.orgs[0]!.settings.ssoProviders![0] as { config: Record<string, unknown> };
    expect(stored.config.clientSecret).toBe('shhh');
  });

  it('DELETE unknown provider id → 404', async () => {
    const store: Store = {
      orgs: [{ id: 'org_1', isEnterprise: true, settings: {} }],
      events: [],
    };
    const app = await build(store, 'org_1');
    const res = await app.inject({ method: 'DELETE', url: '/v1/sso/providers/sso_missing' });
    expect(res.statusCode).toBe(404);
  });
});
