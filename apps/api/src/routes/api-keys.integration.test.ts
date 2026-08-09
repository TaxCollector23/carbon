import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupIntegration,
  shouldRunIntegration,
  type IntegrationHandle,
} from '../../vitest.setup-integration.js';

describe.skipIf(!shouldRunIntegration())('api-keys (integration)', () => {
  let h: IntegrationHandle;

  beforeAll(async () => {
    h = await setupIntegration();
  });

  afterAll(async () => {
    await h?.cleanup();
  });

  it('creates, lists, revokes, and reflects revokedAt in the underlying row', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: { ...h.authHeaders, 'content-type': 'application/json' },
      payload: { name: 'ephemeral', scopes: ['read'] },
    });
    expect(create.statusCode).toBe(201);
    const minted = create.json() as { id: string; presented: string; prefix: string };
    expect(minted.presented).toMatch(/^ck_live_/);

    const list = await h.app.inject({
      method: 'GET',
      url: '/v1/api-keys',
      headers: h.authHeaders,
    });
    expect(list.statusCode).toBe(200);
    const rows = (list.json() as { data: Array<{ id: string; prefix: string }> }).data;
    // Only non-revoked rows are surfaced. Our bootstrap admin key + the one
    // we just minted should both be present.
    expect(rows.some((r) => r.id === minted.id)).toBe(true);
    expect(rows.some((r) => r.id === h.apiKey.id)).toBe(true);

    // Revoke the freshly minted key (never revoke the bootstrap key — that
    // would 401 every subsequent call in this test file).
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/v1/api-keys/${minted.id}`,
      headers: h.authHeaders,
    });
    expect(del.statusCode).toBe(204);

    // GET /v1/api-keys filters out revoked keys, so read the row directly
    // to confirm `revokedAt` was populated by the DELETE.
    const { schema } = await import('@carbon/database');
    const { eq } = await import('drizzle-orm');
    const [row] = await h.db
      .select({ id: schema.apiKeys.id, revokedAt: schema.apiKeys.revokedAt })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, minted.id));
    expect(row?.revokedAt).toBeInstanceOf(Date);

    // A second DELETE on the same id must now 404 — the plugin skips
    // already-revoked rows so 204 would be misleading.
    const again = await h.app.inject({
      method: 'DELETE',
      url: `/v1/api-keys/${minted.id}`,
      headers: h.authHeaders,
    });
    expect(again.statusCode).toBe(404);
  });
});
