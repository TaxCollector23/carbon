import { Queue, Worker, type Job, type Processor } from 'bullmq';
import IORedis, { type RedisOptions } from 'ioredis';
import type { Logger } from '@carbon/core';

/**
 * Thin, typed wrapper around BullMQ. Each queue is declared once and returns
 * a strongly-typed producer + a registerHandler helper. All queues share a
 * single Redis connection factory to keep resource usage predictable.
 */
export interface QueueDefinition<Payload, Result = void> {
  readonly name: string;
  /** Runtime tag only — not sent on the wire. Used to help catch mismatches. */
  readonly __payload?: Payload;
  readonly __result?: Result;
}

export function defineQueue<Payload, Result = void>(
  name: string,
): QueueDefinition<Payload, Result> {
  return { name };
}

export interface QueueRegistryOptions {
  readonly redis: RedisOptions | string | IORedis;
  readonly logger: Logger;
}

export class QueueRegistry {
  private readonly connection: IORedis;
  private readonly ownsConnection: boolean;
  private readonly logger: Logger;
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];

  constructor(opts: QueueRegistryOptions) {
    if (opts.redis instanceof IORedis) {
      this.connection = opts.redis;
      this.ownsConnection = false;
    } else if (typeof opts.redis === 'string') {
      this.connection = new IORedis(opts.redis, { maxRetriesPerRequest: null });
      this.ownsConnection = true;
    } else {
      this.connection = new IORedis({ ...opts.redis, maxRetriesPerRequest: null });
      this.ownsConnection = true;
    }
    this.logger = opts.logger.child({ component: 'workers' });
  }

  producer<P, R>(def: QueueDefinition<P, R>): Producer<P> {
    const queue = this.queues.get(def.name) ?? new Queue(def.name, { connection: this.connection });
    this.queues.set(def.name, queue);
    return {
      enqueue: async (payload: P, opts?: { readonly delay?: number; readonly jobId?: string }) => {
        const job = await queue.add(def.name, payload, {
          delay: opts?.delay,
          jobId: opts?.jobId,
          removeOnComplete: 1000,
          removeOnFail: 5000,
        });
        this.logger.debug('workers.enqueued', { queue: def.name, jobId: job.id });
        return { jobId: job.id ?? '' };
      },
    };
  }

  handle<P, R>(def: QueueDefinition<P, R>, processor: Processor<P, R>): void {
    const worker = new Worker<P, R>(def.name, processor, { connection: this.connection });
    worker.on('failed', (job: Job | undefined, err) => {
      this.logger.error('workers.job_failed', {
        queue: def.name,
        jobId: job?.id,
        message: err.message,
      });
    });
    this.workers.push(worker);
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all(Array.from(this.queues.values()).map((q) => q.close()));
    if (this.ownsConnection) await this.connection.quit();
  }
}

export interface Producer<Payload> {
  enqueue(
    payload: Payload,
    opts?: { readonly delay?: number; readonly jobId?: string },
  ): Promise<{ jobId: string }>;
}

export interface WebhookDeliveryPayload {
  readonly url: string;
  readonly event: string;
  readonly body: unknown;
  readonly secret?: string;
  readonly attempt?: number;
}

/** Canonical queue definitions consumed across the backend. */
export const Queues = {
  ingest: defineQueue<{ projectSlug: string; source: string }>('carbon.ingest'),
  enrich: defineQueue<{ projectSlug: string; irId: string }>('carbon.enrich'),
  snapshot: defineQueue<{ projectSlug: string; name: string }>('carbon.snapshot'),
  webhookDelivery: defineQueue<WebhookDeliveryPayload, { status: number }>('carbon.webhook.delivery'),
} as const;
