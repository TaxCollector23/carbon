import type { Redis } from 'ioredis';
import type { Logger } from '@carbon/core';
import { redisChannelForOrg, type PublishedEvent } from './events.js';

/**
 * Redis-backed cross-instance fanout for SSE subscribers, multiplexed onto a
 * SINGLE `duplicate()`d ioredis client.
 *
 * Every dashboard tab opening `/v1/events/stream` used to spin up its own
 * `ctx.redis.duplicate()` and `subscribe(channelForOrg)` — 100 tabs = 100
 * duplicated Redis connections. This bus keeps one subscribe-mode connection
 * process-wide, holds a `Map<orgId, Set<listener>>`, subscribes lazily on the
 * first listener for an org, and unsubscribes when the set empties.
 *
 * Consumers register via `subscribe(orgId, listener)` and get back an
 * `unsubscribe` fn. The bus never throws to the caller — a broken subscriber
 * connection just means cross-instance frames won't arrive (the in-process
 * `eventBus` in ./events.ts still delivers same-instance frames).
 */
export class RedisEventBus {
  private subscriber: Redis | undefined;
  private subscriberReady: Promise<Redis | undefined> | undefined;
  private readonly listeners = new Map<string, Set<(evt: PublishedEvent) => void>>();
  private closed = false;

  constructor(
    private readonly source: Redis,
    private readonly logger?: Logger,
  ) {}

  async subscribe(
    orgId: string,
    listener: (evt: PublishedEvent) => void,
  ): Promise<() => void> {
    if (this.closed) {
      // Bus was torn down (server shutdown). Return a no-op unsubscribe so
      // the SSE handler's cleanup path stays uniform.
      return () => {};
    }

    let set = this.listeners.get(orgId);
    const isFirstForOrg = !set || set.size === 0;
    if (!set) {
      set = new Set();
      this.listeners.set(orgId, set);
    }
    set.add(listener);

    if (isFirstForOrg) {
      try {
        const sub = await this.ensureSubscriber();
        if (sub) {
          await sub.subscribe(redisChannelForOrg(orgId));
        }
      } catch (err) {
        this.logger?.warn('event_bus.subscribe_failed', {
          orgId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return () => this.unsubscribe(orgId, listener);
  }

  private unsubscribe(orgId: string, listener: (evt: PublishedEvent) => void): void {
    const set = this.listeners.get(orgId);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) {
      this.listeners.delete(orgId);
      const sub = this.subscriber;
      if (sub) {
        sub.unsubscribe(redisChannelForOrg(orgId)).catch((err: unknown) => {
          this.logger?.warn('event_bus.unsubscribe_failed', {
            orgId,
            message: err instanceof Error ? err.message : String(err),
          });
        });
      }
    }
  }

  private async ensureSubscriber(): Promise<Redis | undefined> {
    if (this.subscriber) return this.subscriber;
    if (!this.subscriberReady) {
      this.subscriberReady = (async () => {
        try {
          const sub = this.source.duplicate();
          sub.on('message', (channel: string, message: string) => this.deliver(channel, message));
          sub.on('error', (err: unknown) => {
            this.logger?.warn('event_bus.subscriber_error', {
              message: err instanceof Error ? err.message : String(err),
            });
          });
          this.subscriber = sub;
          return sub;
        } catch (err) {
          this.logger?.warn('event_bus.duplicate_failed', {
            message: err instanceof Error ? err.message : String(err),
          });
          this.subscriberReady = undefined;
          return undefined;
        }
      })();
    }
    return this.subscriberReady;
  }

  private deliver(channel: string, message: string): void {
    // Channel shape is `carbon:events:<orgId>` — parse the tail once instead
    // of storing a reverse map.
    const orgId = channel.startsWith('carbon:events:') ? channel.slice('carbon:events:'.length) : '';
    if (!orgId) return;
    const set = this.listeners.get(orgId);
    if (!set || set.size === 0) return;
    let evt: PublishedEvent;
    try {
      evt = JSON.parse(message) as PublishedEvent;
    } catch {
      return;
    }
    for (const listener of set) {
      try {
        listener(evt);
      } catch (err) {
        this.logger?.warn('event_bus.listener_threw', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    const sub = this.subscriber;
    this.subscriber = undefined;
    this.subscriberReady = undefined;
    if (sub) {
      try {
        await sub.quit();
      } catch {
        sub.disconnect();
      }
    }
  }
}

/**
 * Lazy process-wide singleton. Keyed by the source Redis instance so that a
 * fresh source (e.g. a test that swaps `ctx.redis`) gets its own bus rather
 * than reusing a stale subscriber.
 */
let singleton: { source: Redis; bus: RedisEventBus } | undefined;

export function getRedisEventBus(source: Redis, logger?: Logger): RedisEventBus {
  if (singleton && singleton.source === source) return singleton.bus;
  if (singleton) {
    // Different source (only happens in tests / dev restarts) — tear down the
    // stale one so its ioredis connection is not leaked.
    void singleton.bus.close();
  }
  const bus = new RedisEventBus(source, logger);
  singleton = { source, bus };
  return bus;
}

export async function shutdownRedisEventBus(): Promise<void> {
  const current = singleton;
  singleton = undefined;
  if (current) await current.bus.close();
}
