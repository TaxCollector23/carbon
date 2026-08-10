import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { CarbonError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import { zodBody, zodResponse } from '../plugins/schema-helpers.js';

/**
 * Public, unauthenticated lead-capture endpoint. Backs the
 * apps/web /contact form. Rate-limited per IP (5/hour) at the route level
 * because the global control-plane limiter is shared across all anonymous
 * traffic and a single spammer should not exhaust that budget.
 */

const LeadBody = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  company: z.string().min(1).max(200),
  seats: z.coerce.number().int().min(1).max(100_000).optional(),
  useCase: z.string().max(4000).optional(),
  source: z.string().max(200).optional(),
});

const LeadResponse = z.object({ id: z.string(), createdAt: z.string() });

const LEAD_LIMIT = 5;
const LEAD_WINDOW_MS = 60 * 60 * 1000;

interface Bucket {
  count: number;
  resetAt: number;
}

/** In-process per-IP limiter — good enough for a low-volume marketing form. */
function makeIpLimiter(max: number, windowMs: number) {
  const buckets = new Map<string, Bucket>();
  return function check(ip: string): { ok: true } | { ok: false; retryAfterSec: number } {
    const now = Date.now();
    const b = buckets.get(ip);
    if (!b || b.resetAt <= now) {
      buckets.set(ip, { count: 1, resetAt: now + windowMs });
      return { ok: true };
    }
    b.count += 1;
    if (b.count > max) {
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
    }
    return { ok: true };
  };
}

/** Public paths added to the API's `publicPaths` set so no API key is required. */
export const LEADS_PUBLIC_PATHS: readonly string[] = ['/v1/leads'];

export interface LeadsOptions {
  /** Overridable for tests; default uses a fresh in-process limiter. */
  readonly limiter?: ReturnType<typeof makeIpLimiter>;
}

export async function registerLeadsRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  opts: LeadsOptions = {},
): Promise<void> {
  const limiter = opts.limiter ?? makeIpLimiter(LEAD_LIMIT, LEAD_WINDOW_MS);

  app.post('/v1/leads', {
    schema: {
      summary: 'Submit an Enterprise / sales lead',
      description:
        'Unauthenticated. Backs the marketing site\'s /contact form. Rate-limited per IP (5/hour).',
      body: zodBody(LeadBody),
      response: { 201: zodResponse(LeadResponse) },
    },
  }, async (req, reply) => {
    const gate = limiter(req.ip);
    if (!gate.ok) {
      reply.header('retry-after', String(gate.retryAfterSec));
      throw new CarbonError({
        code: 'CARBON_RATE_LIMITED',
        message: 'Too many lead submissions from this IP — please try again shortly',
        expose: true,
      });
    }
    const body = LeadBody.parse(req.body ?? {});
    const id = `lead_${randomBytes(12).toString('hex')}`;
    const createdAt = new Date();
    const ua = req.headers['user-agent'];
    const userAgent = typeof ua === 'string' ? ua.slice(0, 500) : null;
    await ctx.db.insert(schema.leads).values({
      id,
      email: body.email.trim().toLowerCase(),
      name: body.name.trim(),
      company: body.company.trim(),
      seats: body.seats ?? null,
      useCase: body.useCase?.trim() ?? null,
      source: body.source?.trim() ?? null,
      ip: req.ip,
      userAgent,
      createdAt,
    });
    ctx.logger.info('leads.captured', {
      id,
      email: body.email,
      company: body.company,
      seats: body.seats,
      source: body.source,
    });
    reply.status(201);
    return { id, createdAt: createdAt.toISOString() };
  });
}
