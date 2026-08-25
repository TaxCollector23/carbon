import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { CarbonError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import { zodBody, zodResponse } from '../plugins/schema-helpers.js';

/**
 * Public, unauthenticated funnel-tracking endpoint. Backs the marketing
 * site's "did anyone actually click this" question: page views, CTA clicks,
 * sandbox starts. Deliberately minimal and privacy-conscious:
 *
 *   - Only a one-way SHA-256 of the client IP is stored (unique-visitor
 *     bucketing without storing an identifier).
 *   - `action` is a strict `[a-z0-9._-]` token — no free text.
 *   - `metadata` is sanitized to scalar values and size-capped.
 *
 * Rate-limited per IP with a generous in-process limiter (marketing events
 * are high-volume relative to leads, but one bot should not flood the DB).
 */
const ACTION_PATTERN = /^[a-z0-9._-]{1,100}$/;

const TrackBody = z.object({
  action: z.string().regex(ACTION_PATTERN),
  path: z.string().max(200).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const TrackResponse = z.object({ id: z.string() });

const TRACK_LIMIT = 300;
const TRACK_WINDOW_MS = 60 * 1000;

interface Bucket {
  count: number;
  resetAt: number;
}

function makeIpLimiter(max: number, windowMs: number) {
  const buckets = new Map<string, Bucket>();
  return function check(ip: string): { ok: true } | { ok: false } {
    const now = Date.now();
    const b = buckets.get(ip);
    if (!b || b.resetAt <= now) {
      buckets.set(ip, { count: 1, resetAt: now + windowMs });
      return { ok: true };
    }
    b.count += 1;
    if (b.count > max) return { ok: false };
    return { ok: true };
  };
}

/** Public paths added to the API's `publicPaths` set so no API key is required. */
export const TRACK_PUBLIC_PATHS: readonly string[] = ['/v1/track'];

const MAX_METADATA_KEYS = 8;
const MAX_STRING_LENGTH = 200;

/**
 * Reduce arbitrary client metadata to a safe, small shape: scalar values
 * only, keys capped, string values truncated. Nested objects and arrays are
 * dropped — funnel analytics don't need them and they're a payload-bloat and
 * log-injection vector.
 */
function sanitizeMetadata(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!raw) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_METADATA_KEYS) break;
    if (typeof value === 'string') {
      out[key.slice(0, MAX_STRING_LENGTH)] = value.slice(0, MAX_STRING_LENGTH);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key.slice(0, MAX_STRING_LENGTH)] = value;
    } else if (typeof value === 'boolean') {
      out[key.slice(0, MAX_STRING_LENGTH)] = value;
    }
    // null/objects/arrays intentionally dropped.
  }
  return out;
}

export async function registerTrackRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  opts: { limiter?: ReturnType<typeof makeIpLimiter> } = {},
): Promise<void> {
  const limiter = opts.limiter ?? makeIpLimiter(TRACK_LIMIT, TRACK_WINDOW_MS);

  app.post(
    '/v1/track',
    {
      schema: {
        summary: 'Record an anonymous funnel event',
        description:
          'Unauthenticated. Appends a row to anonymous_events with a one-way hash of the client IP. Action must match [a-z0-9._-]. Rate-limited per IP.',
        body: zodBody(TrackBody),
        response: { 201: zodResponse(TrackResponse) },
      },
    },
    async (req, reply) => {
      if (!limiter(req.ip).ok) {
        throw new CarbonError({
          code: 'CARBON_RATE_LIMITED',
          message: 'Too many events from this IP',
          expose: true,
        });
      }
      const body = TrackBody.parse(req.body ?? {});
      const ua = req.headers['user-agent'];
      const userAgent = typeof ua === 'string' ? ua.slice(0, 200) : null;
      const id = `evt_${randomBytes(12).toString('hex')}`;
      await ctx.db.insert(schema.anonymousEvents).values({
        id,
        action: body.action,
        ipHash: sha256Hex(req.ip),
        path: body.path?.slice(0, 200) ?? null,
        userAgent,
        metadata: sanitizeMetadata(body.metadata),
      });
      ctx.logger.debug('track.event', { action: body.action, path: body.path });
      reply.status(201);
      return { id };
    },
  );
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
