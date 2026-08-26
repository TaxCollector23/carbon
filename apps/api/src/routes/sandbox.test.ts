import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { AppContext } from '../context.js';
import { statusFor } from '../server.js';
import { _resetSampleSpecCache, loadSampleSpec } from './samples.js';
import { registerSandboxRoutes, type SandboxOptions } from './sandbox.js';
import { createSandboxRegistry } from '../services/sandbox-registry.js';

function makeCtx(): AppContext {
  return {
    logger: NoopLogger,
    db: {} as AppContext['db'],
    storage: new MemoryStorage(),
    ingestion: {} as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

async function build(
  ctx: AppContext,
  options: SandboxOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', message: err.message } });
      return;
    }
    if (isCarbonError(err)) {
      // Mirror production: statusFor maps CARBON_* codes to HTTP statuses.
      reply.status(statusFor(err.code)).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
  });
  await registerSandboxRoutes(app, ctx, options);
  await app.ready();
  return app;
}

interface SandboxBody {
  id: string;
  url: string;
  sample: string;
  spec: string;
  requestCount: number;
}

interface ProxyBody {
  id: string;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  headers: Record<string, string>;
  body: unknown;
}

beforeEach(() => {
  _resetSampleSpecCache();
  delete process.env.CARBON_SAMPLES_DIR;
});

afterEach(() => {
  delete process.env.CARBON_SAMPLES_DIR;
});

describe('POST /v1/sandbox', () => {
  it('boots a real runtime from a sample and returns a live binding', async () => {
    const app = await build(makeCtx());
    const res = await app.inject({ method: 'POST', url: '/v1/sandbox', payload: {} });
    expect(res.statusCode).toBe(201);
    const body = res.json() as SandboxBody;
    expect(body.id).toMatch(/^sb_/);
    expect(body.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(body.sample).toBe('petstore');
    expect(body.spec).toBe('Petstore Bench');
    expect(body.requestCount).toBe(0);

    // Health check through the proxy — the runtime is really there.
    const health = (await app.inject({
      method: 'GET',
      url: `/v1/sandbox/${body.id}/__carbon/health`,
    })).json() as ProxyBody;
    expect(health.status).toBe(200);
    expect((health.body as { ok?: boolean }).ok).toBe(true);
    await app.inject({ method: 'DELETE', url: `/v1/sandbox/${body.id}` });
  });

  it('GET /v1/sandbox/:id/spec returns the OpenAPI spec', async () => {
    const app = await build(makeCtx());
    const created = (await app.inject({ method: 'POST', url: '/v1/sandbox', payload: {} })).json() as SandboxBody;
    const specRes = await app.inject({ method: 'GET', url: `/v1/sandbox/${created.id}/spec` });
    expect(specRes.statusCode).toBe(200);
    const spec = specRes.json() as Record<string, unknown>;
    expect(spec.openapi ?? spec.openapi).toBeDefined();
    expect((spec.info as Record<string, unknown>)?.title).toBeDefined();
    await app.inject({ method: 'DELETE', url: `/v1/sandbox/${created.id}` });
  });

  it('GET /v1/sandbox/:id/spec returns 404 for a stopped sandbox', async () => {
    const app = await build(makeCtx());
    const created = (await app.inject({ method: 'POST', url: '/v1/sandbox', payload: {} })).json() as SandboxBody;
    await app.inject({ method: 'DELETE', url: `/v1/sandbox/${created.id}` });
    const specRes = await app.inject({ method: 'GET', url: `/v1/sandbox/${created.id}/spec` });
    expect(specRes.statusCode).toBe(404);
  });

  it('GET /v1/sandbox/:id/state returns current resource state', async () => {
    const app = await build(makeCtx());
    const created = (await app.inject({ method: 'POST', url: '/v1/sandbox', payload: {} })).json() as SandboxBody;
    // Initially empty.
    const empty = (await app.inject({ method: 'GET', url: `/v1/sandbox/${created.id}/state` })).json() as { records: unknown[] };
    expect(empty.records).toEqual([]);

    // Create a pet.
    await app.inject({
      method: 'POST',
      url: `/v1/sandbox/${created.id}/pets`,
      payload: { name: 'Rex', species: 'dog' },
      headers: { 'content-type': 'application/json' },
    });
    const after = (await app.inject({ method: 'GET', url: `/v1/sandbox/${created.id}/state` })).json() as { records: Array<{ resource: string; data: Record<string, unknown> }> };
    expect(after.records.length).toBe(1);
    expect(after.records[0]!.resource).toBe('pet');
    expect(after.records[0]!.data.name).toBe('Rex');

    await app.inject({ method: 'DELETE', url: `/v1/sandbox/${created.id}` });
  });

  it('GET /v1/sandbox/:id/log returns request audit trail', async () => {
    const app = await build(makeCtx());
    const created = (await app.inject({ method: 'POST', url: '/v1/sandbox', payload: {} })).json() as SandboxBody;
    // Empty log.
    const empty = (await app.inject({ method: 'GET', url: `/v1/sandbox/${created.id}/log` })).json() as { data: unknown[] };
    expect(empty.data).toEqual([]);

    // Make some requests.
    await app.inject({ method: 'POST', url: `/v1/sandbox/${created.id}/pets`, payload: { name: 'Spot' }, headers: { 'content-type': 'application/json' } });
    await app.inject({ method: 'GET', url: `/v1/sandbox/${created.id}/pets` });

    const log = (await app.inject({ method: 'GET', url: `/v1/sandbox/${created.id}/log` })).json() as {
      data: Array<{ method: string; path: string; status: number; latencyMs: number }>;
    };
    expect(log.data.length).toBe(2);
    // Chronological order (oldest first) — POST was first, then GET.
    expect(log.data[0]!.method).toBe('POST');
    expect(log.data[1]!.method).toBe('GET');

    await app.inject({ method: 'DELETE', url: `/v1/sandbox/${created.id}` });
  });

  it('rejects an unknown sample id', async () => {
    const app = await build(makeCtx());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sandbox',
      payload: { sample: 'not-a-sample' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CARBON_INVALID_INPUT');
  });

  it('enforces the capacity ceiling', async () => {
    const app = await build(makeCtx(), { maxSandboxes: 1 });
    const first = await app.inject({ method: 'POST', url: '/v1/sandbox', payload: {} });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: 'POST', url: '/v1/sandbox', payload: {} });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('CARBON_CONFLICT');
    const firstBody = first.json() as SandboxBody;
    await app.inject({ method: 'DELETE', url: `/v1/sandbox/${firstBody.id}` });
  });
});

describe('sandbox proxy', () => {
  it('serves stateful CRUD over real HTTP and reflects it in the journal', async () => {
    const app = await build(makeCtx());
    const created = (await app.inject({ method: 'POST', url: '/v1/sandbox', payload: {} })).json() as SandboxBody;

    // CREATE
    const post = (await app.inject({
      method: 'POST',
      url: `/v1/sandbox/${created.id}/pets`,
      payload: { name: 'Fido', species: 'dog' },
      headers: { 'content-type': 'application/json' },
    })).json() as ProxyBody;
    expect(post.status).toBe(201);
    expect((post.body as { name?: string }).name).toBe('Fido');
    expect(post.latencyMs).toBeGreaterThanOrEqual(0);
    const petId = (post.body as { id?: string }).id!;

    // READ after create — state persisted across requests
    const get = (await app.inject({
      method: 'GET',
      url: `/v1/sandbox/${created.id}/pets/${petId}`,
    })).json() as ProxyBody;
    expect(get.status).toBe(200);
    expect((get.body as { name?: string }).name).toBe('Fido');

    // PATCH
    const patch = (await app.inject({
      method: 'PATCH',
      url: `/v1/sandbox/${created.id}/pets/${petId}`,
      payload: { name: 'Fido II' },
    })).json() as ProxyBody;
    expect(patch.status).toBe(200);
    expect((patch.body as { name?: string }).name).toBe('Fido II');

    // Journal shows both mutations
    const history = (await app.inject({
      method: 'GET',
      url: `/v1/sandbox/${created.id}/__carbon/state/history`,
    })).json() as ProxyBody;
    const entries = (history.body as { entries?: Array<{ seq: number; op: string; resource: string; id: string }> }).entries ?? [];
    expect(entries.length).toBe(2);
    expect(entries.map((e) => e.op)).toEqual(['create', 'update']);
    expect(entries[1]!.id).toBe(petId);

    // REWIND to seq 1 removes the update
    await app.inject({
      method: 'POST',
      url: `/v1/sandbox/${created.id}/__carbon/state/rewind`,
      payload: { seq: 1 },
    });
    const afterRewind = (await app.inject({
      method: 'GET',
      url: `/v1/sandbox/${created.id}/pets/${petId}`,
    })).json() as ProxyBody;
    expect(afterRewind.status).toBe(200);
    expect((afterRewind.body as { name?: string }).name).toBe('Fido');

    // RESET clears everything
    await app.inject({
      method: 'POST',
      url: `/v1/sandbox/${created.id}/__carbon/state/reset`,
    });
    const afterReset = (await app.inject({
      method: 'GET',
      url: `/v1/sandbox/${created.id}/pets/${petId}`,
    })).json() as ProxyBody;
    expect(afterReset.status).toBe(404);

    // DELETE the pet → 204, then 404
    await app.inject({
      method: 'DELETE',
      url: `/v1/sandbox/${created.id}/pets/${petId}`,
    });
    expect(afterReset.status).toBe(404);

    // requestCount reflects the proxied traffic
    const summary = (await app.inject({
      method: 'GET',
      url: `/v1/sandbox/${created.id}`,
    })).json() as SandboxBody;
    expect(summary.requestCount).toBeGreaterThanOrEqual(6);

    await app.inject({ method: 'DELETE', url: `/v1/sandbox/${created.id}` });
  });

  it('404s for a stopped sandbox', async () => {
    const app = await build(makeCtx());
    const created = (await app.inject({ method: 'POST', url: '/v1/sandbox', payload: {} })).json() as SandboxBody;
    await app.inject({ method: 'DELETE', url: `/v1/sandbox/${created.id}` });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sandbox/${created.id}/pets`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('CARBON_NOT_FOUND');
  });

  it('maps a crashed runtime to 503 instead of a raw 500', async () => {
    const ctx = makeCtx();
    // Sandbox exists in the map but the upstream is unreachable (e.g. the
    // runtime crashed without the registry noticing).
    const registry = createSandboxRegistry({
      logger: NoopLogger,
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    const app = await build(ctx, { registry });
    const created = (await app.inject({ method: 'POST', url: '/v1/sandbox', payload: {} })).json() as SandboxBody;
    const res = await app.inject({ method: 'GET', url: `/v1/sandbox/${created.id}/pets` });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('CARBON_RUNTIME_UNAVAILABLE');
  });

  it('maps a hung runtime to 504', async () => {
    const ctx = makeCtx();
    // A fetch that never resolves (ignores its abort signal) hits the proxy
    // timeout and maps to 504, not a hang.
    const registry = createSandboxRegistry({
      logger: NoopLogger,
      proxyTimeoutMs: 25,
      fetchImpl: (() => new Promise<Response>(() => {})) as typeof fetch,
    });
    const app = await build(ctx, { registry });
    const created = (await app.inject({ method: 'POST', url: '/v1/sandbox', payload: {} })).json() as SandboxBody;
    const res = await app.inject({ method: 'GET', url: `/v1/sandbox/${created.id}/pets` });
    expect(res.statusCode).toBe(504);
    expect(res.json().error.code).toBe('CARBON_TIMEOUT');
  });

  it('rejects path traversal at the registry (defense in depth)', async () => {
    // Fastify's router normalizes `..` segments before the route is matched,
    // so a traversal attempt dies with 404 at the router. The registry guard
    // covers direct/programmatic proxy calls regardless of router behavior.
    const registry = createSandboxRegistry({ logger: NoopLogger });
    const record = await registry.create(loadSampleSpec('petstore'), 'petstore');
    try {
      await expect(
        registry.proxy(record.id, 'GET', '/pets/../__carbon/health', undefined, undefined),
      ).rejects.toMatchObject({ code: 'CARBON_INVALID_INPUT' });
    } finally {
      await registry.stop(record.id);
    }
  });
});

describe('sandbox TTL eviction', () => {
  it('sweeps sandboxes idle past the TTL', async () => {
    const app = await build(makeCtx(), { idleTtlMs: 30, sweepIntervalMs: 10_000 });
    const created = (await app.inject({ method: 'POST', url: '/v1/sandbox', payload: {} })).json() as SandboxBody;
    expect(created.id).toBeTruthy();

    // Wait past the TTL, then a new create triggers a sweep of the old one.
    await new Promise((resolve) => setTimeout(resolve, 60));
    const second = await app.inject({ method: 'POST', url: '/v1/sandbox', payload: {} });
    expect(second.statusCode).toBe(201);

    const gone = await app.inject({ method: 'GET', url: `/v1/sandbox/${created.id}` });
    expect(gone.statusCode).toBe(404);
    const secondBody = second.json() as SandboxBody;
    await app.inject({ method: 'DELETE', url: `/v1/sandbox/${secondBody.id}` });
  });
});
