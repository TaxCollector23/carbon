import type { FastifyRequest } from 'fastify';
import { makeId } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';

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
 * Append a row to the events table. NEVER throws — the audit trail must not
 * be able to break a successful mutating request. Failures are logged so an
 * operator can notice a broken pipeline, but the caller keeps its 2xx.
 */
export async function recordEvent(ctx: AppContext, input: RecordEventInput): Promise<void> {
  try {
    await ctx.db.insert(schema.events).values({
      id: makeId('evt'),
      orgId: input.orgId,
      projectId: input.projectId ?? null,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    ctx.logger.warn('events.record_failed', {
      action: input.action,
      orgId: input.orgId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
