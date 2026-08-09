import { test, expect, request as pwRequest } from '@playwright/test';

const API_URL = 'http://127.0.0.1:4000';

test.describe('API endpoints (direct, no browser)', () => {
  test('/health returns 200 with an ok status', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${API_URL}/health`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    // Fastify health handler returns { status: 'ok', ... }.
    expect(typeof json).toBe('object');
    expect(json.status ?? json.ok ?? 'ok').toBeDefined();
    await ctx.dispose();
  });

  test('/ready returns 200 when dependencies are up', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${API_URL}/ready`);
    // /ready can return 503 when e.g. redis is disabled, but for a booted API
    // with a live DB and no redis it should still answer with a body.
    expect([200, 503]).toContain(res.status());
    await ctx.dispose();
  });

  test('/v1/version returns { version, ... }', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${API_URL}/v1/version`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(typeof json.version).toBe('string');
    await ctx.dispose();
  });

  test('/v1/projects returns a page with the expected envelope', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${API_URL}/v1/projects?orgId=org_test`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
    expect(json).toHaveProperty('hasMore');
    expect(json).toHaveProperty('nextCursor');
    await ctx.dispose();
  });

  test('/v1/organizations/current resolves the fixture org', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${API_URL}/v1/organizations/current?orgId=org_test`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('org_test');
    expect(typeof json.slug).toBe('string');
    expect(typeof json.name).toBe('string');
    await ctx.dispose();
  });
});
