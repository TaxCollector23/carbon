import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupIntegration,
  shouldRunIntegration,
  type IntegrationHandle,
} from '../../vitest.setup-integration.js';
import { recordUsage } from '../services/usage.js';

describe.skipIf(!shouldRunIntegration())('usage (integration)', () => {
  let h: IntegrationHandle;

  beforeAll(async () => {
    h = await setupIntegration();
  });

  afterAll(async () => {
    await h?.cleanup();
  });

  it('aggregates raw usage events through GET /v1/usage', async () => {
    // Simulate the emulator start / snapshot / ingest meter calls that live
    // in the emulator route — the shared code path is `recordUsage`.
    await recordUsage(h.ctx, { orgId: h.orgId, kind: 'emulator.start', amount: 1 });
    await recordUsage(h.ctx, { orgId: h.orgId, kind: 'emulator.start', amount: 1 });
    await recordUsage(h.ctx, { orgId: h.orgId, kind: 'snapshot.write', amount: 3 });

    const res = await h.app.inject({
      method: 'GET',
      url: '/v1/usage',
      headers: h.authHeaders,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      orgId: string;
      totals: Array<{ kind: string; total: number }>;
    };
    expect(body.orgId).toBe(h.orgId);
    const byKind = Object.fromEntries(body.totals.map((t) => [t.kind, t.total]));
    expect(byKind['emulator.start']).toBe(2);
    expect(byKind['snapshot.write']).toBe(3);

    const events = await h.app.inject({
      method: 'GET',
      url: '/v1/usage/events?limit=10',
      headers: h.authHeaders,
    });
    expect(events.statusCode).toBe(200);
    const eventRows = (events.json() as { data: Array<{ kind: string }> }).data;
    expect(eventRows.length).toBeGreaterThanOrEqual(3);
  });
});
