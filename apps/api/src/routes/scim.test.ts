import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { registerScimRoutes } from './scim.js';

/**
 * SCIM shim: enough to answer the three queries the enterprise gate + list
 * users flow issues. The plugin's preHandler resolves an X-SCIM-Token by
 * selecting on api_keys; the gate then reads organizations.isEnterprise; the
 * list users query joins memberships x users.
 */
interface ApiKey {
  id: string;
  orgId: string;
  prefix: string;
  hash: string;
  scopes: string[];
  projectIds: string[] | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
}
interface OrgRow { id: string; isEnterprise: boolean; }
interface UserRow { id: string; email: string; name: string | null; createdAt: Date; updatedAt: Date; }
interface Membership { userId: string; orgId: string; role: string; }

interface Store {
  apiKeys: ApiKey[];
  orgs: OrgRow[];
  users: UserRow[];
  memberships: Membership[];
}

function makeDb(store: Store): AppContext['db'] {
  let lastTable: unknown = null;
  const selectChain = () => {
    const chain: any = {
      from: (t: unknown) => {
        lastTable = t;
        return chain;
      },
      innerJoin: () => chain,
      where: () => chain,
      limit: async (_n: number) => resolve(),
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected),
    };
    return chain;
  };
  const resolve = (): any[] => {
    if (lastTable === schema.apiKeys) return store.apiKeys;
    if (lastTable === schema.organizations) return store.orgs;
    if (lastTable === schema.memberships) {
      return store.memberships.map((m) => {
        const u = store.users.find((x) => x.id === m.userId);
        return {
          userId: m.userId,
          role: m.role,
          email: u?.email ?? '',
          name: u?.name ?? null,
          createdAt: u?.createdAt ?? new Date(),
          updatedAt: u?.updatedAt ?? new Date(),
        };
      });
    }
    return [];
  };
  return {
    select: () => selectChain(),
    insert: () => ({ values: async () => {} }),
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

async function build(store: Store, presetApiKey?: AuthenticatedRequest['apiKey']): Promise<FastifyInstance> {
  const app = Fastify();
  if (presetApiKey) {
    app.addHook('onRequest', async (req) => {
      (req as AuthenticatedRequest).apiKey = presetApiKey;
    });
  }
  await registerScimRoutes(app, makeCtx(store));
  await app.ready();
  return app;
}

function hashOf(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

describe('SCIM routes', () => {
  it('rejects non-enterprise orgs with a 403 SCIM error', async () => {
    const store: Store = {
      apiKeys: [],
      orgs: [{ id: 'org_1', isEnterprise: false }],
      users: [],
      memberships: [],
    };
    const app = await build(store, {
      id: 'k', orgId: 'org_1', prefix: 'aa11bb22cc33', scopes: ['admin'],
      projectIds: null, expiresAt: null,
    });
    const res = await app.inject({ method: 'GET', url: '/scim/v2/Users' });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { schemas: string[]; detail: string };
    expect(body.schemas[0]).toContain('scim');
    expect(body.detail).toMatch(/enterprise/i);
  });

  it('X-SCIM-Token authenticates and List Users returns the SCIM ListResponse shape', async () => {
    const secret = 'a'.repeat(32);
    const store: Store = {
      apiKeys: [{
        id: 'key_scim', orgId: 'org_1', prefix: 'aa11bb22cc33',
        hash: hashOf(secret), scopes: ['admin'],
        projectIds: null, revokedAt: null, expiresAt: null,
      }],
      orgs: [{ id: 'org_1', isEnterprise: true }],
      users: [{
        id: 'usr_1', email: 'alice@acme.io', name: 'Alice',
        createdAt: new Date(), updatedAt: new Date(),
      }],
      memberships: [{ userId: 'usr_1', orgId: 'org_1', role: 'member' }],
    };
    const app = await build(store);
    const res = await app.inject({
      method: 'GET',
      url: '/scim/v2/Users',
      headers: { 'x-scim-token': `ck_live_aa11bb22cc33.${secret}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      schemas: string[];
      totalResults: number;
      Resources: Array<{ userName: string; schemas: string[] }>;
    };
    expect(body.schemas[0]).toContain('ListResponse');
    expect(body.totalResults).toBe(1);
    expect(body.Resources[0]?.userName).toBe('alice@acme.io');
    expect(body.Resources[0]?.schemas[0]).toContain('User');
  });

  it('missing token → 401 SCIM error', async () => {
    const store: Store = {
      apiKeys: [], orgs: [{ id: 'org_1', isEnterprise: true }],
      users: [], memberships: [],
    };
    const app = await build(store);
    const res = await app.inject({ method: 'GET', url: '/scim/v2/Users' });
    expect(res.statusCode).toBe(401);
  });
});
