import { describe, expect, it } from 'vitest';
import { isIngestJobPayload } from './ingest-worker.js';

describe('isIngestJobPayload', () => {
  it('accepts valid json and text ingest payloads', () => {
    expect(
      isIngestJobPayload({
        statusJobId: 'job_1',
        orgId: 'org_1',
        projectSlug: 'org_1/acme',
        publicSlug: 'acme',
        source: { kind: 'json', content: { openapi: '3.0.0' } },
        origin: 'unit',
        enrich: false,
      }),
    ).toBe(true);

    expect(
      isIngestJobPayload({
        statusJobId: 'job_2',
        projectSlug: 'sandbox',
        source: { kind: 'text', content: 'asyncapi: 2.6.0' },
      }),
    ).toBe(true);
  });

  it('rejects payloads that cannot be re-enqueued safely', () => {
    expect(isIngestJobPayload(null)).toBe(false);
    expect(isIngestJobPayload({ projectSlug: 'acme', source: { kind: 'json' } })).toBe(false);
    expect(
      isIngestJobPayload({
        statusJobId: 'job_1',
        projectSlug: '',
        source: { kind: 'json' },
      }),
    ).toBe(false);
    expect(
      isIngestJobPayload({
        statusJobId: 'job_1',
        projectSlug: 'acme',
        source: { kind: 'graphql' },
      }),
    ).toBe(false);
  });
});
