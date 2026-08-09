import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupIntegration,
  shouldRunIntegration,
  type IntegrationHandle,
} from '../../vitest.setup-integration.js';

describe.skipIf(!shouldRunIntegration())('events (integration)', () => {
  let h: IntegrationHandle;

  beforeAll(async () => {
    h = await setupIntegration();
  });

  afterAll(async () => {
    await h?.cleanup();
  });

  it('records a project.created event visible through GET /v1/events', async () => {
    const slug = `evt-${Math.random().toString(36).slice(2, 8)}`;
    const create = await h.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { ...h.authHeaders, 'content-type': 'application/json' },
      payload: { slug, name: 'Events IT' },
    });
    expect(create.statusCode).toBe(201);
    const { id: projectId } = create.json() as { id: string };

    const list = await h.app.inject({
      method: 'GET',
      url: `/v1/events?limit=100&projectId=${projectId}`,
      headers: h.authHeaders,
    });
    expect(list.statusCode).toBe(200);
    const rows = (list.json() as {
      data: Array<{ action: string; projectId: string | null; actorType: string }>;
    }).data;
    const created = rows.find((r) => r.action === 'project.created');
    expect(created).toBeDefined();
    expect(created?.projectId).toBe(projectId);
    // The integration bootstrap uses an api-key, so the actor should be
    // classified as such — not the `system` fallback.
    expect(created?.actorType).toBe('api_key');
  });
});
