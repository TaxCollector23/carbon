import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { AppContext } from '../context.js';
import { createIngestMetrics, registerMetrics, type JobCountsSource } from './metrics.js';

function makeCtx(): AppContext {
  return {
    logger: NoopLogger,
    db: {} as AppContext['db'],
    storage: new MemoryStorage(),
    ingestion: {} as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

/** Test double for BullMQ's `Queue.getJobCounts`. */
function fakeQueue(counts: Record<string, number>): JobCountsSource & { calls: number } {
  return {
    calls: 0,
    async getJobCounts(...states: string[]) {
      this.calls += 1;
      const out: Record<string, number> = {};
      for (const s of states) out[s] = counts[s] ?? 0;
      return out;
    },
  };
}

async function readMetrics(app: ReturnType<typeof Fastify>): Promise<string> {
  const res = await app.inject('/metrics');
  expect(res.statusCode).toBe(200);
  return res.body;
}

describe('metrics — ingest queue', () => {
  it('renders queue depth after the poller reports counts', async () => {
    const app = Fastify();
    const ingest = createIngestMetrics({ pollIntervalMs: 3_600_000 });
    await registerMetrics(app, makeCtx(), { ingest });

    // No poll yet → the depth series is intentionally absent so a broken
    // poller is visible as a gap rather than as false zeros.
    let body = await readMetrics(app);
    expect(body).not.toMatch(/carbon_ingest_queue_depth\{state="waiting"\}/);

    const queue = fakeQueue({ waiting: 3, active: 1, delayed: 0, failed: 2, completed: 7 });
    ingest.attachQueue(queue);
    // attachQueue kicks an initial poll; await it before asserting.
    await new Promise((r) => setImmediate(r));

    body = await readMetrics(app);
    expect(body).toMatch(/carbon_ingest_queue_depth\{state="waiting"\} 3/);
    expect(body).toMatch(/carbon_ingest_queue_depth\{state="active"\} 1/);
    expect(body).toMatch(/carbon_ingest_queue_depth\{state="failed"\} 2/);
    expect(body).toMatch(/carbon_ingest_queue_depth\{state="completed"\} 7/);

    await app.close();
  });

  it('records worker outcomes and duration histogram', async () => {
    const app = Fastify();
    const ingest = createIngestMetrics({ pollIntervalMs: 3_600_000 });
    await registerMetrics(app, makeCtx(), { ingest });

    ingest.sink.onActiveDelta(1);
    ingest.sink.onActiveDelta(1);
    ingest.sink.onJobResult({ outcome: 'succeeded', durationMs: 750 });
    ingest.sink.onActiveDelta(-1);
    ingest.sink.onJobResult({ outcome: 'failed', durationMs: 12_000 });
    ingest.sink.onActiveDelta(-1);

    const body = await readMetrics(app);
    expect(body).toMatch(/carbon_ingest_job_result_total\{outcome="succeeded"\} 1/);
    expect(body).toMatch(/carbon_ingest_job_result_total\{outcome="failed"\} 1/);
    expect(body).toMatch(/carbon_ingest_job_duration_ms_count 2/);
    // 750ms lands in the 1000ms bucket; 12000ms lands in the 15000ms bucket.
    expect(body).toMatch(/carbon_ingest_job_duration_ms_bucket\{le="1000"\} 1/);
    expect(body).toMatch(/carbon_ingest_job_duration_ms_bucket\{le="15000"\} 2/);
    expect(body).toMatch(/carbon_ingest_worker_active 0/);

    await app.close();
  });

  it('stops polling on server close so tests do not hang', async () => {
    const app = Fastify();
    const ingest = createIngestMetrics({ pollIntervalMs: 5 });
    await registerMetrics(app, makeCtx(), { ingest });
    const queue = fakeQueue({ waiting: 0 });
    ingest.attachQueue(queue);

    await new Promise((r) => setTimeout(r, 25));
    await app.close();
    const callsAtClose = queue.calls;
    await new Promise((r) => setTimeout(r, 25));
    expect(queue.calls).toBe(callsAtClose);
  });

  it('leaves existing HTTP metrics intact', async () => {
    const app = Fastify();
    await registerMetrics(app, makeCtx(), {});
    const body = await readMetrics(app);
    expect(body).toMatch(/carbon_http_requests_in_flight/);
    await app.close();
  });
});
