import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { registerShareLinkRoutes } from './share-links.js';

interface Link {
  id: string;
  projectId: string;
  token: string;
  createdBy: string | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

interface Store {
  links: Link[];
  artifacts: Array<{ id: string; projectId: string; kind: string; storageKey: string; createdAt: Date }>;
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
      orderBy: () => chain,
      limit: async (_n: number) => {
        if (lastTable === schema.shareLinks) {
          // The route selects with token+notExpired+notRevoked OR id lookup.
          // Return the freshest live link; the caller applies its own filter
          // by checking revoked/expired after the fact in some cases, but
          // more importantly the JS-side check in the tests below simulates
          // the real predicate: we filter here manually.
          const now = new Date();
          const live = store.links.find(
            (l) => !l.revokedAt && l.expiresAt.getTime() > now.getTime(),
          );
          return live ? [{ ...live, projectSlug: 'demo' }] : [];
        }
        if (lastTable === schema.artifacts) {
          const snap = store.artifacts.find((a) => a.kind === 'snapshot');
          return snap ? [snap] : [];
        }
        return [];
      },
    };
    return chain;
  };
  return {
    select: () => selectChain(),
    insert: (table: unknown) => ({
      values: (v: any) => {
        if (table === schema.shareLinks) {
          const row: Link = {
            id: v.id, projectId: v.projectId, token: v.token,
            createdBy: v.createdBy ?? null,
            createdAt: new Date(),
            expiresAt: v.expiresAt,
            revokedAt: null,
          };
          store.links.push(row);
          const p: any = Promise.resolve();
          p.returning = async () => [row];
          return p;
        }
        // Events / other: just resolve.
        return Promise.resolve();
      },
    }),
    update: (_table: unknown) => ({
      set: (p: Partial<Link>) => ({
        where: async () => {
          for (const l of store.links) Object.assign(l, p);
        },
      }),
    }),
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

async function build(store: Store): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', message: err.message } });
      return;
    }
    if (isCarbonError(err)) {
      const status =
        err.code === 'CARBON_NOT_FOUND' ? 410
          : err.code === 'CARBON_FORBIDDEN' ? 403
          : 500;
      reply.status(status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
  });
  app.addHook('onRequest', async (req) => {
    (req as AuthenticatedRequest).apiKey = {
      id: 'k', orgId: 'org_1', prefix: 'aa', scopes: ['write'], projectIds: null, expiresAt: null,
    };
  });
  await registerShareLinkRoutes(app, makeCtx(store), {
    requireProjectInOrg: async (_ctx, _req, projectId) => ({
      id: projectId, orgId: 'org_1', slug: projectId,
    }),
  });
  await app.ready();
  return app;
}

describe('share-links routes', () => {
  it('create → GET state returns the snapshot → DELETE revokes → subsequent GET is 410', async () => {
    const store: Store = {
      links: [],
      artifacts: [{
        id: 'art_1', projectId: 'proj_1', kind: 'snapshot',
        storageKey: 'projects/demo/snapshot/x.json', createdAt: new Date(),
      }],
    };
    const app = await build(store);

    const create = await app.inject({
      method: 'POST',
      url: '/v1/projects/proj_1/share-links',
      payload: { ttlHours: 1 },
    });
    expect(create.statusCode).toBe(201);
    const body = create.json() as { id: string; token: string; url: string };
    expect(body.token).toHaveLength(32);
    expect(store.links).toHaveLength(1);

    // GET state — public, only needs the token.
    const state = await app.inject({ method: 'GET', url: `/v1/share-links/${body.token}/state` });
    expect(state.statusCode).toBe(200);
    const stateBody = state.json() as { projectId: string; state: { id: string } | null };
    expect(stateBody.projectId).toBe('proj_1');
    expect(stateBody.state?.id).toBe('art_1');

    // DELETE revokes.
    const del = await app.inject({ method: 'DELETE', url: `/v1/share-links/${body.id}` });
    expect(del.statusCode).toBe(204);
    expect(store.links[0]!.revokedAt).not.toBeNull();

    // Subsequent state read → 410 (mapped from NotFoundError in the shim above).
    const after = await app.inject({ method: 'GET', url: `/v1/share-links/${body.token}/state` });
    expect(after.statusCode).toBe(410);
  });

  it('expired token → 410 on GET state', async () => {
    const store: Store = {
      links: [{
        id: 'shl_expired', projectId: 'proj_1', token: 'x'.repeat(32),
        createdBy: null, createdAt: new Date(),
        expiresAt: new Date(Date.now() - 1000), revokedAt: null,
      }],
      artifacts: [],
    };
    const app = await build(store);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/share-links/${'x'.repeat(32)}/state`,
    });
    expect(res.statusCode).toBe(410);
  });
});
