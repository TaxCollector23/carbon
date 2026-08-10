import { EventEmitter } from 'node:events';
import type { FastifyRequest } from 'fastify';
import { makeId } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { recordEventCounter } from '../plugins/metrics.js';

/**
 * Actor derived from an incoming request. `system` is the fallback used when
 * neither an API key nor a browser session is attached (e.g. dev mode with
 * `CARBON_AUTH_MODE=disabled`, or an internal caller).
 */
export type ActorType = 'user' | 'api_key' | 'system';

export interface Actor {
  readonly actorType: ActorType;
  readonly actorId: string | null;
}

/**
 * Read the actor off a request. Only the API-key path is wired today —
 * once Better Auth session verification lands in apps/api (Phase 2) this can
 * grow a `user` branch reading the resolved session user id.
 */
export function getActor(req: FastifyRequest): Actor {
  const apiKey = (req as AuthenticatedRequest).apiKey;
  if (apiKey) return { actorType: 'api_key', actorId: apiKey.id };
  return { actorType: 'system', actorId: null };
}

export interface RecordEventInput {
  readonly orgId: string;
  readonly projectId?: string | null;
  readonly actorType: ActorType;
  readonly actorId?: string | null;
  readonly action: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Serialized shape published to the in-process emitter and Redis pub/sub. It
 * mirrors the row a subsequent list call would return, so SSE subscribers can
 * treat a live event exactly as if it had come from `GET /v1/events`.
 */
export interface PublishedEvent {
  readonly id: string;
  readonly orgId: string;
  readonly projectId: string | null;
  readonly actorType: ActorType;
  readonly actorId: string | null;
  readonly action: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

/**
 * Process-local fanout for freshly-recorded events. The SSE route subscribes
 * here; `recordEvent` publishes after a successful insert. A single emitter
 * for the whole process keeps the fanout O(subscribers) and avoids leaking
 * per-connection listeners onto the ctx.
 *
 * NOTE: `EventEmitter` warns at 10 listeners by default. A real-time dashboard
 * can easily exceed that in a single process, so we lift the cap; the ceiling
 * is still enforced by process memory.
 */
export const eventBus: EventEmitter = new EventEmitter();
eventBus.setMaxListeners(0);

/** Redis pub/sub channel for a given org. */
export function redisChannelForOrg(orgId: string): string {
  return `carbon:events:${orgId}`;
}

/**
 * Append a row to the events table. NEVER throws — the audit trail must not
 * be able to break a successful mutating request. Failures are logged so an
 * operator can notice a broken pipeline, but the caller keeps its 2xx.
 *
 * After a successful write we fan the event out to the in-process bus and,
 * when Redis is present, to `carbon:events:<orgId>` for cross-instance SSE
 * delivery. Both publish paths are best-effort — a broken bus never blocks
 * the audit write.
 */
export async function recordEvent(ctx: AppContext, input: RecordEventInput): Promise<void> {
  const id = makeId('evt');
  const createdAt = new Date();
  let inserted = false;
  try {
    await ctx.db.insert(schema.events).values({
      id,
      orgId: input.orgId,
      projectId: input.projectId ?? null,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      metadata: input.metadata ?? {},
    });
    inserted = true;
    recordEventCounter(input.action);
  } catch (err) {
    ctx.logger.warn('events.record_failed', {
      action: input.action,
      orgId: input.orgId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  if (!inserted) return;

  const payload: PublishedEvent = {
    id,
    orgId: input.orgId,
    projectId: input.projectId ?? null,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    action: input.action,
    metadata: input.metadata ?? {},
    createdAt: createdAt.toISOString(),
  };

  try {
    eventBus.emit('new-event', payload);
  } catch (err) {
    ctx.logger.warn('events.publish_failed', {
      target: 'emitter',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  if (ctx.redis) {
    try {
      await ctx.redis.publish(redisChannelForOrg(input.orgId), JSON.stringify(payload));
    } catch (err) {
      ctx.logger.warn('events.publish_failed', {
        target: 'redis',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
