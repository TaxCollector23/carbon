import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupIntegration,
  shouldRunIntegration,
  type IntegrationHandle,
} from '../../vitest.setup-integration.js';
import { recordAiQualityReport } from '../services/ai-quality.js';

describe.skipIf(!shouldRunIntegration())('ai-quality (integration)', () => {
  let h: IntegrationHandle;

  beforeAll(async () => {
    h = await setupIntegration();
  });

  afterAll(async () => {
    await h?.cleanup();
  });

  it('surfaces the latest recorded report through GET /v1/projects/:id/ai-quality/latest', async () => {
    const written = await recordAiQualityReport(h.ctx, {
      projectId: h.projectId,
      irKey: 'ir/integration/latest',
      threshold: 0.75,
      verdicts: {
        resources: {
          score: 0.88,
          issues: [{ severity: 'info', targetType: 'field', targetId: 'user.name', reason: 'nit' }],
          model: 'test-model',
        },
        relationships: {
          score: 0.92,
          issues: [],
          model: 'test-model',
        },
      },
    });

    const res = await h.app.inject({
      method: 'GET',
      url: `/v1/projects/${h.projectId}/ai-quality/latest`,
      headers: h.authHeaders,
    });
    expect(res.statusCode).toBe(200);
    const row = res.json() as {
      id: string;
      projectId: string;
      minScore: string;
      needsReview: boolean;
    };
    expect(row.id).toBe(written.id);
    expect(row.projectId).toBe(h.projectId);
    // `minScore` is stored as numeric(precision, scale) so postgres.js hands
    // it back as a string — 0.88 rounded to four decimals.
    expect(Number(row.minScore)).toBeCloseTo(0.88, 4);
    expect(row.needsReview).toBe(false);
  });
});
