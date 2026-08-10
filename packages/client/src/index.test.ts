import { describe, expect, it, vi } from 'vitest';
import { createCarbonClient, CarbonError, type CarbonClient } from './index';

/**
 * These tests exercise the wrapper — not the real network. We stub `fetch`
 * to make sure:
 *   1) requests reach the right URL,
 *   2) the `Authorization` middleware fires when `apiKey` is provided,
 *   3) typed responses round-trip cleanly, and
 *   4) `CarbonError` unpacks a standard error body.
 */

function stubFetch(response: {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}): typeof fetch {
  return vi.fn(async () => {
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { 'content-type': 'application/json', ...(response.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
}

describe('createCarbonClient', () => {
  it('returns a typed client and resolves GET /v1/projects', async () => {
    const fetchStub = stubFetch({
      body: { data: [{ id: 'p_1', name: 'demo', slug: 'demo' }] },
    });
    const client: CarbonClient = createCarbonClient({
      baseUrl: 'http://carbon.test',
      fetch: fetchStub,
    });

    const { data, error, response } = await client.GET('/v1/projects');
    expect(error).toBeUndefined();
    expect(response.status).toBe(200);
    // Type-only: `data` is narrowed to the GET /v1/projects response schema.
    expect(data).toEqual({ data: [{ id: 'p_1', name: 'demo', slug: 'demo' }] });

    const calls = (fetchStub as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const req = calls[0]![0] as Request;
    expect(req.url).toBe('http://carbon.test/v1/projects');
  });

  it('adds Authorization header when apiKey is provided', async () => {
    const fetchStub = stubFetch({ body: { data: [] } });
    const client = createCarbonClient({
      baseUrl: 'http://carbon.test',
      apiKey: 'sk_test_123',
      fetch: fetchStub,
    });
    await client.GET('/v1/projects');
    const req = (fetchStub as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as Request;
    expect(req.headers.get('authorization')).toBe('Bearer sk_test_123');
  });

  it('does not add Authorization when apiKey is omitted', async () => {
    const fetchStub = stubFetch({ body: { data: [] } });
    const client = createCarbonClient({
      baseUrl: 'http://carbon.test',
      fetch: fetchStub,
    });
    await client.GET('/v1/projects');
    const req = (fetchStub as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as Request;
    expect(req.headers.get('authorization')).toBeNull();
  });
});

describe('CarbonError', () => {
  it('unpacks a standard { status, code, message, details } body', () => {
    const err = new CarbonError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'project not found',
      details: { projectId: 'p_missing' },
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CarbonError');
    expect(err.status).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('project not found');
    expect(err.details).toEqual({ projectId: 'p_missing' });
  });

  it('falls back to the raw Response status when the body is opaque', () => {
    const resp = new Response('oops', { status: 500 });
    const err = new CarbonError('oops', resp);
    expect(err.status).toBe(500);
    expect(err.code).toBe('CARBON_ERROR');
    expect(err.response).toBe(resp);
  });
});
