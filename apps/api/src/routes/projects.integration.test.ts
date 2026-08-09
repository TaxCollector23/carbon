import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupIntegration,
  shouldRunIntegration,
  type IntegrationHandle,
} from '../../vitest.setup-integration.js';

describe.skipIf(!shouldRunIntegration())('projects (integration)', () => {
  let h: IntegrationHandle;

  beforeAll(async () => {
    h = await setupIntegration();
  });

  afterAll(async () => {
    await h?.cleanup();
  });

  it('round-trips a project through POST + GET list + GET by id', async () => {
    const slug = `it-${Math.random().toString(36).slice(2, 8)}`;
    const create = await h.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { ...h.authHeaders, 'content-type': 'application/json' },
      payload: { slug, name: 'My IT Project' },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as { id: string; slug: string; orgId: string };
    expect(created.orgId).toBe(h.orgId);
    expect(created.slug).toBe(slug);

    const list = await h.app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: h.authHeaders,
    });
    expect(list.statusCode).toBe(200);
    const listed = list.json() as { data: Array<{ id: string; slug: string }> };
    expect(listed.data.map((r) => r.slug)).toContain(slug);

    const get = await h.app.inject({
      method: 'GET',
      url: `/v1/projects/${created.id}`,
      headers: h.authHeaders,
    });
    expect(get.statusCode).toBe(200);
    const row = get.json() as { id: string; slug: string; orgId: string };
    expect(row.id).toBe(created.id);
    expect(row.orgId).toBe(h.orgId);
  });

  it('rejects duplicate slugs with a Postgres unique-violation surfaced as 409', async () => {
    const slug = `dup-${Math.random().toString(36).slice(2, 8)}`;
    const first = await h.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { ...h.authHeaders, 'content-type': 'application/json' },
      payload: { slug, name: 'Dup A' },
    });
    expect(first.statusCode).toBe(201);
    const second = await h.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { ...h.authHeaders, 'content-type': 'application/json' },
      payload: { slug, name: 'Dup B' },
    });
    // Driver error mapping turns unique-violation into CARBON_CONFLICT (409).
    expect(second.statusCode).toBe(409);
  });
});
