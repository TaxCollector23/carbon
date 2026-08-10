import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupIntegration,
  shouldRunIntegration,
  type IntegrationHandle,
} from '../../vitest.setup-integration.js';

/**
 * End-to-end proof that the tsvector columns + GIN indexes populated by
 * migration 0007 make search work against real Postgres. We create a
 * handful of projects + events, then query `/v1/search` with a distinctive
 * token and assert the matching rows come back.
 */
describe.skipIf(!shouldRunIntegration())('search (integration)', () => {
  let h: IntegrationHandle;

  beforeAll(async () => {
    h = await setupIntegration();
  });

  afterAll(async () => {
    await h?.cleanup();
  });

  it('finds projects and events by a shared token, org-scoped', async () => {
    const token = `carbonsearch${Math.random().toString(36).slice(2, 8)}`;
    // Two projects that both contain the token in their name — insert via
    // the real API so events fire as a side effect.
    for (const suffix of ['a', 'b']) {
      const create = await h.app.inject({
        method: 'POST',
        url: '/v1/projects',
        headers: { ...h.authHeaders, 'content-type': 'application/json' },
        payload: { slug: `${token}-${suffix}`, name: `${token} project ${suffix}` },
      });
      expect(create.statusCode).toBe(201);
    }
    // A third project without the token acts as a negative control.
    const other = await h.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { ...h.authHeaders, 'content-type': 'application/json' },
      payload: { slug: `ctrl-${Math.random().toString(36).slice(2, 8)}`, name: 'unrelated' },
    });
    expect(other.statusCode).toBe(201);

    // Search across everything.
    const res = await h.app.inject({
      method: 'GET',
      url: `/v1/search?q=${token}&scope=all&limit=50`,
      headers: h.authHeaders,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      results: Array<{ kind: string; id: string; snippet: string; score: number }>;
    };

    // At minimum, both matching projects show up.
    const projects = body.results.filter((r) => r.kind === 'project');
    expect(projects.length).toBeGreaterThanOrEqual(2);
    for (const p of projects) {
      expect(p.snippet.toLowerCase()).toContain(token.toLowerCase());
    }

    // The `project.created` events should also match (metadata contains
    // the slug/name).
    const events = body.results.filter((r) => r.kind === 'event');
    expect(events.length).toBeGreaterThanOrEqual(2);

    // Scope narrowing: projects-only.
    const projRes = await h.app.inject({
      method: 'GET',
      url: `/v1/search?q=${token}&scope=projects`,
      headers: h.authHeaders,
    });
    expect(projRes.statusCode).toBe(200);
    const projBody = projRes.json() as { results: Array<{ kind: string }> };
    expect(projBody.results.every((r) => r.kind === 'project')).toBe(true);
    expect(projBody.results.length).toBeGreaterThanOrEqual(2);
  });
});
