import { describe, expect, it } from 'vitest';
import { NoopLogger, NotFoundError } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';
import type { AppContext } from './context.js';

function makeCtx(): AppContext {
  return {
    logger: NoopLogger,
    db: {
      execute: async () => [],
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    } as unknown as AppContext['db'],
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: { list: () => [] } as unknown as AppContext['emulators'],
  };
}

async function build(
  probe?: (app: FastifyInstance) => void,
  options: Parameters<typeof buildServer>[2] = {},
): Promise<FastifyInstance> {
  const app = await buildServer(makeCtx(), NoopLogger, options);
  probe?.(app);
  await app.ready();
  return app;
}

describe('server', () => {
  it('echoes a request id on every response', async () => {
    const app = await build();
    const res = await app.inject('/health');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('honours a well-formed inbound x-request-id so traces survive the proxy', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'trace-abc-123' },
    });
    expect(res.headers['x-request-id']).toBe('trace-abc-123');
  });

  it('rejects an inbound request id that could inject into log output', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'abcdefgh\nlevel=fatal msg=owned' },
    });
    expect(res.headers['x-request-id']).not.toContain('owned');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns a structured JSON 404 for unknown routes', async () => {
    const app = await build();
    const res = await app.inject('/v1/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('CARBON_NOT_FOUND');
  });

  it('maps a Postgres unique violation to 409 rather than 500', async () => {
    const app = await build((instance) => {
      instance.get('/boom', async () => {
        throw Object.assign(new Error('duplicate key'), {
          code: '23505',
          constraint_name: 'projects_org_slug_unique',
        });
      });
    });

    const res = await app.inject('/boom');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CARBON_CONFLICT');
  });

  it('sends Retry-After when the database is unreachable', async () => {
    const app = await build((instance) => {
      instance.get('/boom', async () => {
        throw Object.assign(new Error('connection failure'), { code: '08006' });
      });
    });

    const res = await app.inject('/boom');
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('2');
  });

  it('redacts unexposed error messages but keeps exposed ones', async () => {
    const app = await build((instance) => {
      instance.get('/exposed', async () => {
        throw new NotFoundError('project', 'acme');
      });
      instance.get('/hidden', async () => {
        throw new Error('SELECT * FROM secrets WHERE token = ...');
      });
    });

    expect((await app.inject('/exposed')).json().error.message).toBe('project acme not found');
    const hidden = await app.inject('/hidden');
    expect(hidden.statusCode).toBe(500);
    expect(hidden.json().error.message).toBe('Internal error');
  });

  it('rejects an oversized body as 413, not 500', async () => {
    const app = await build(
      (instance) => {
        instance.post('/echo', async () => ({ ok: true }));
      },
      { bodyLimitBytes: 128 },
    );

    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ pad: 'x'.repeat(500) }),
    });

    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('CARBON_INVALID_INPUT');
  });

  it('serves malformed JSON as 400', async () => {
    const app = await build((instance) => {
      instance.post('/echo', async () => ({ ok: true }));
    });

    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });

    expect(res.statusCode).toBe(400);
  });

  describe('with auth enforced', () => {
    const authed = { auth: { mode: 'enforced' as const } };

    it('keeps operational and documentation endpoints reachable', async () => {
      const app = await build(undefined, authed);
      for (const path of ['/health', '/ready', '/metrics', '/openapi.json', '/v1/version']) {
        const res = await app.inject(path);
        expect(res.statusCode, `${path} should not require a key`).not.toBe(401);
      }
    });

    it('still closes the actual API surface', async () => {
      const app = await build(undefined, authed);
      expect((await app.inject('/v1/projects')).statusCode).toBe(401);
    });

    it('gates /docs and /openapi.json behind the API key when publicDocs=false', async () => {
      const app = await build(undefined, { ...authed, publicDocs: false });
      expect((await app.inject('/openapi.json')).statusCode).toBe(401);
      // Scalar's plugin registers its own encapsulated error handler, so a
      // rejected /docs request surfaces as 500 rather than 401 — but the auth
      // hook still fires and refuses to serve the reference without a key.
      const docsRes = await app.inject('/docs/');
      expect(docsRes.statusCode).toBeGreaterThanOrEqual(400);
      expect(docsRes.body).toContain('CARBON_UNAUTHENTICATED');
      // Operational endpoints still reachable.
      expect((await app.inject('/health')).statusCode).not.toBe(401);
    });

    it('requires a bearer token for /metrics when one is configured', async () => {
      const app = await build(undefined, { ...authed, metricsToken: 'shhh-token' });

      expect((await app.inject('/metrics')).statusCode).toBe(401);
      const ok = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: 'Bearer shhh-token' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.body).toContain('carbon_http_requests_total');
    });
  });

  it('ignores X-Forwarded-For by default so callers cannot spoof req.ip', async () => {
    const app = await build((instance) => {
      instance.get('/ip', async (req) => ({ ip: req.ip }));
    });
    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      headers: { 'x-forwarded-for': '9.9.9.9' },
    });
    expect(res.json().ip).not.toBe('9.9.9.9');
  });

  it('honours X-Forwarded-For only when trustedProxyHops is set', async () => {
    const app = await build(
      (instance) => {
        instance.get('/ip', async (req) => ({ ip: req.ip }));
      },
      { trustedProxyHops: 1 },
    );
    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      headers: { 'x-forwarded-for': '9.9.9.9' },
    });
    expect(res.json().ip).toBe('9.9.9.9');
  });

  it('exposes route-labelled metrics with a valid histogram', async () => {
    const app = await build();
    await app.inject('/health');
    await app.inject('/v1/nope');

    const body = (await app.inject('/metrics')).body;
    expect(body).toContain('route="/health"');
    expect(body).toContain('route="unmatched"');
    expect(body).toContain('carbon_http_requests_in_flight 0');
    expect(body).toContain('carbon_nodejs_eventloop_lag_ms');

    // Histogram buckets must be monotonically non-decreasing and end at count.
    const buckets = [
      ...body.matchAll(/duration_ms_bucket\{route="\/health",le="([^"]+)"\} (\d+)/g),
    ];
    expect(buckets.length).toBeGreaterThan(1);
    const values = buckets.map(([, , v]) => Number(v));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
    }
    const total = /duration_ms_count\{route="\/health"\} (\d+)/.exec(body);
    expect(Number(total![1])).toBe(values[values.length - 1]);
  });
});
