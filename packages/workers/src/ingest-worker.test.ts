import { describe, expect, it, vi } from 'vitest';
import { NoopLogger } from '@carbon/core';
import {
  isIngestJobPayload,
  registerIngestWorker,
  type IngestJobPayload,
} from './ingest-worker.js';

const bullMqMock = vi.hoisted(() => ({
  processor: undefined as undefined | ((job: unknown) => Promise<unknown>),
}));

vi.mock('bullmq', () => ({
  Queue: class {
    add = vi.fn();
    close = vi.fn();
  },
  Worker: class {
    constructor(_name: string, processor: (job: unknown) => Promise<unknown>) {
      bullMqMock.processor = processor;
    }
    on() {
      return this;
    }
    close = vi.fn();
  },
}));

describe('isIngestJobPayload', () => {
  it('accepts valid json and text ingest payloads', () => {
    expect(
      isIngestJobPayload({
        statusJobId: 'job_1',
        projectId: 'proj_1',
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
        projectId: '',
        projectSlug: 'acme',
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

describe('registerIngestWorker', () => {
  it('runs completion hooks without letting hook failures fail the job', async () => {
    const payload: IngestJobPayload = {
      statusJobId: 'job_1',
      projectId: 'proj_1',
      orgId: 'org_1',
      projectSlug: 'org_1/acme',
      publicSlug: 'acme',
      source: { kind: 'json', content: { openapi: '3.0.0' } },
    };
    const updates: unknown[] = [];
    const hook = vi.fn(async () => {
      throw new Error('postgres down');
    });

    registerIngestWorker({
      connection: {} as never,
      ingestion: {
        ingest: vi.fn(async () => ({
          irId: 'ir_1',
          graphId: 'graph_1',
          ir: { api: { title: 'Acme' }, endpoints: [1, 2], resources: [1] },
          warnings: ['warn'],
          judge: {
            resources: { score: 0.91, issues: [] },
            relationships: { score: 0.82, issues: [] },
          },
        })),
      },
      jobs: {
        update: vi.fn(async (_id, patch) => {
          updates.push(patch);
        }),
      },
      logger: NoopLogger,
      onCompletedIngest: hook,
    });

    await expect(
      bullMqMock.processor?.({
        id: 'bull_1',
        data: payload,
        opts: { attempts: 1 },
        attemptsMade: 0,
      }),
    ).resolves.toMatchObject({ irId: 'ir_1', endpoints: 2, resources: 1 });

    expect(hook).toHaveBeenCalledWith({
      payload,
      result: expect.objectContaining({ irId: 'ir_1', graphId: 'graph_1' }),
    });
    expect(updates).toEqual([
      { status: 'running' },
      {
        status: 'succeeded',
        result: expect.objectContaining({
          irId: 'ir_1',
          graphId: 'graph_1',
          endpoints: 2,
          resources: 1,
        }),
      },
    ]);
  });
});
