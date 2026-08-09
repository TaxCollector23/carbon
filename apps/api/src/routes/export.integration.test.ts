import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupIntegration,
  shouldRunIntegration,
  type IntegrationHandle,
} from '../../vitest.setup-integration.js';
import { recordUsage } from '../services/usage.js';

describe.skipIf(!shouldRunIntegration())('export (integration)', () => {
  let h: IntegrationHandle;

  beforeAll(async () => {
    h = await setupIntegration();
  });

  afterAll(async () => {
    await h?.cleanup();
  });

  it('bundles real DB rows across the requested includes', async () => {
    // Seed some observable state across a few includes.
    await recordUsage(h.ctx, { orgId: h.orgId, kind: 'ingest.doc', amount: 5 });
    const created = await h.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { ...h.authHeaders, 'content-type': 'application/json' },
      payload: { slug: `exp-${Math.random().toString(36).slice(2, 8)}`, name: 'Export IT' },
    });
    expect(created.statusCode).toBe(201);

    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/export',
      headers: { ...h.authHeaders, 'content-type': 'application/json' },
      payload: { include: ['projects', 'usage', 'events', 'api_keys'], format: 'json' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      orgId: string;
      bundle: {
        projects: Array<{ id: string; orgId: string }>;
        usage: Array<{ kind: string }>;
        events: Array<{ action: string }>;
        api_keys: Array<{ id: string; prefix: string; hash?: unknown }>;
      };
    };
    expect(body.orgId).toBe(h.orgId);
    expect(body.bundle.projects.length).toBeGreaterThanOrEqual(2); // fixture + one above
    expect(body.bundle.projects.every((p) => p.orgId === h.orgId)).toBe(true);
    expect(body.bundle.usage.some((u) => u.kind === 'ingest.doc')).toBe(true);
    expect(body.bundle.events.some((e) => e.action === 'project.created')).toBe(true);
    expect(body.bundle.api_keys.some((k) => k.id === h.apiKey.id)).toBe(true);
    // The export must NEVER surface the api-key hash column.
    for (const key of body.bundle.api_keys) {
      expect(key.hash).toBeUndefined();
    }
  });
});
