import { afterEach, describe, expect, it } from 'vitest';
import { BehaviorGraphBuilder } from '@carbon/graph';
import { InMemoryStateEngine } from '@carbon/state';
import type {
  EndpointId,
  IntermediateRepresentation,
  ResourceId,
} from '@carbon/types';
import { createRuntime, type Runtime } from './runtime.js';
import { errorInjectionPlugin, latencyPlugin, authPlugin } from './plugins/index.js';

const customer = 'customer' as ResourceId;

function ir(): IntermediateRepresentation {
  return {
    version: 1,
    api: { name: 't', version: '0', source: { kind: 'openapi', ingestedAt: 0 } },
    servers: [],
    auth: [],
    resources: [{ id: customer, name: 'Customer', primaryKey: 'id', schema: { kind: 'unknown' } }],
    endpoints: [
      {
        id: 'GET:/customers' as EndpointId,
        method: 'GET',
        path: '/customers',
        operation: 'list',
        resource: customer,
        params: [],
        requestBody: null,
        responses: [],
        auth: [],
        meta: {},
      },
      {
        id: 'POST:/customers' as EndpointId,
        method: 'POST',
        path: '/customers',
        operation: 'create',
        resource: customer,
        params: [],
        requestBody: null,
        responses: [],
        auth: [],
        meta: {},
      },
      {
        id: 'GET:/customers/{id}' as EndpointId,
        method: 'GET',
        path: '/customers/{id}',
        operation: 'get',
        resource: customer,
        params: [{ name: 'id', in: 'path', required: true, schema: { kind: 'string' } }],
        requestBody: null,
        responses: [],
        auth: [],
        meta: {},
      },
      {
        id: 'DELETE:/customers/{id}' as EndpointId,
        method: 'DELETE',
        path: '/customers/{id}',
        operation: 'delete',
        resource: customer,
        params: [{ name: 'id', in: 'path', required: true, schema: { kind: 'string' } }],
        requestBody: null,
        responses: [],
        auth: [],
        meta: {},
      },
    ],
    relationships: [],
    examples: [],
    meta: {},
  };
}

async function boot(plugins: Parameters<typeof createRuntime>[0]['plugins'] = []): Promise<Runtime> {
  const spec = ir();
  const graph = new BehaviorGraphBuilder().build(spec);
  const state = new InMemoryStateEngine();
  return createRuntime({ ir: spec, graph, state, plugins });
}

describe('runtime', () => {
  let rt: Runtime | null = null;
  afterEach(async () => {
    if (rt) await rt.close();
    rt = null;
  });

  it('serves state through the compiled routes', async () => {
    rt = await boot();
    const created = await rt.app.inject({
      method: 'POST',
      url: '/customers',
      payload: { name: 'Ada' },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { id: string; name: string };
    expect(body.name).toBe('Ada');

    const got = await rt.app.inject({ method: 'GET', url: `/customers/${body.id}` });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toMatchObject({ id: body.id, name: 'Ada' });

    const list = await rt.app.inject({ method: 'GET', url: '/customers' });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: unknown[] }).data).toHaveLength(1);

    const del = await rt.app.inject({ method: 'DELETE', url: `/customers/${body.id}` });
    expect(del.statusCode).toBe(204);

    const missing = await rt.app.inject({ method: 'GET', url: `/customers/${body.id}` });
    expect(missing.statusCode).toBe(404);
  });

  it('exposes the health endpoint', async () => {
    rt = await boot();
    const res = await rt.app.inject({ method: 'GET', url: '/__carbon/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('rejects requests when auth plugin is strict and no token is presented', async () => {
    rt = await boot([authPlugin({ mode: 'strict', tokens: ['sk_test'] })]);
    const res = await rt.app.inject({ method: 'GET', url: '/customers' });
    expect(res.statusCode).toBe(401);
  });

  it('accepts valid tokens under strict auth', async () => {
    rt = await boot([authPlugin({ mode: 'strict', tokens: ['sk_test'] })]);
    const res = await rt.app.inject({
      method: 'GET',
      url: '/customers',
      headers: { authorization: 'Bearer sk_test' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('honors error-injection rules with a pinned RNG', async () => {
    rt = await boot([
      errorInjectionPlugin(
        [
          {
            match: { path: '/customers' },
            probability: 1,
            action: { kind: 'status', status: 503, body: { error: { code: 'DOWN' } } },
          },
        ],
        () => 0.0, // always fire
      ),
    ]);
    const res = await rt.app.inject({ method: 'GET', url: '/customers' });
    expect(res.statusCode).toBe(503);
  });

  it('latency plugin does not corrupt responses', async () => {
    rt = await boot([latencyPlugin({ floorMs: 1 })]);
    const res = await rt.app.inject({ method: 'GET', url: '/customers' });
    expect(res.statusCode).toBe(200);
  });
});
