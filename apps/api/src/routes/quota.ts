import type { FastifyInstance } from 'fastify';
import { and, eq, gte, sum, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import { resolveCallerOrg } from '../plugins/caller-org.js';
import { requireScope } from '../plugins/scopes.js';
import { zodResponseWithExample } from '../plugins/schema-helpers.js';
import { resolvePlan, type PlanTier } from '../services/billing.js';
import { PLAN_EMULATOR_CEILING } from '../services/emulator-registry.js';
import { PLAN_RATE_LIMITS } from '../plugins/rate-limit.js';

/**
 * Per-plan monthly free-tier AI ingest cap. Mirrors the CLI paywall in
 * `apps/cli/src/lib/quota.ts` (FREE_TIER_INGEST_CAP=10) — kept in sync so the
 * dashboard shows the same number the CLI enforces. Non-developer plans are
 * uncapped for AI ingests today.
 */
export const PLAN_AI_INGEST_CEILING: Record<PlanTier, number | null> = {
  developer: 10,
  team: null,
  enterprise: null,
};

const QuotaResponse = z.object({
  orgId: z.string(),
  plan: z.enum(['developer', 'team', 'enterprise']),
  limits: z.object({
    emulatorsMax: z.number().nullable(),
    requestsPerMinute: z.number().nullable(),
    aiIngestsPerMonth: z.number().nullable(),
  }),
  current: z.object({
    emulators: z.number(),
    requestsLast1m: z.number().nullable(),
    aiIngestsThisMonth: z.number(),
  }),
});

/**
 * `GET /v1/quota` — surface the caller org's plan ceilings and current usage
 * so the dashboard's Settings page can render a compact "Usage & limits"
 * card. `null` limits mean unlimited (enterprise seats, team AI ingests, etc.);
 * `null` `current.requestsLast1m` means the API cannot cheaply compute it in
 * this deployment (e.g. no metrics scrape sink is exposed to routes).
 */
export async function registerQuotaRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/quota', {
    preHandler: requireScope('read'),
    schema: {
      summary: 'Per-org plan limits and current usage',
      description:
        'Return the caller org\'s plan tier, per-plan ceilings, and current usage counters. ' +
        'Powers the dashboard Settings page\'s "Usage & limits" card. `null` limits mean unlimited.',
      response: {
        200: zodResponseWithExample(QuotaResponse, {
          orgId: 'org_01HXK5H7Q9C0R3Q1S8V6M4WJZK',
          plan: 'developer',
          limits: {
            emulatorsMax: 1,
            requestsPerMinute: 60,
            aiIngestsPerMonth: 10,
          },
          current: {
            emulators: 0,
            requestsLast1m: null,
            aiIngestsThisMonth: 3,
          },
        }),
      },
    },
  }, async (req) => {
    const orgId = resolveCallerOrg(req, {
      mode: 'throw',
      message: 'quota is org-scoped — attach an API key or authenticated session',
    });
    const plan = (await resolvePlan(orgId, ctx.db)).plan;

    // Env override wins over plan defaults so a self-hosted operator can pin
    // the emulator cap uniformly — matches the enforcement logic in
    // `createEmulatorRegistry`.
    const envOverrideRaw = process.env.CARBON_MAX_EMULATORS_PER_ORG;
    const envOverride =
      envOverrideRaw && Number.isFinite(Number(envOverrideRaw))
        ? Number(envOverrideRaw)
        : undefined;
    const planCeiling = PLAN_EMULATOR_CEILING[plan];
    const emulatorsMax =
      envOverride !== undefined
        ? envOverride
        : Number.isFinite(planCeiling)
          ? planCeiling
          : null;

    const requestsPerMinute = PLAN_RATE_LIMITS[plan] ?? null;
    const aiIngestsPerMonth = PLAN_AI_INGEST_CEILING[plan];

    // Emulator count is O(entries) in-memory — cheap.
    let emulators = 0;
    try {
      emulators = ctx.emulators.getCountForOrg(orgId);
    } catch {
      emulators = 0;
    }

    // requestsLast1m: cheap counter is not surfaced through ctx today; the
    // rate-limit Redis key is per-identity, not per-org. Return null so the
    // UI can hide/annotate the row rather than lie.
    const requestsLast1m: number | null = null;

    // AI ingests this month: SUM(amount) FROM usage_events WHERE
    // kind='ai_call' AND occurredAt >= monthStart. Mirrors the developer-tier
    // paywall the CLI enforces before calling ingest.
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    let aiIngestsThisMonth = 0;
    try {
      const conditions: SQL[] = [
        eq(schema.usageEvents.orgId, orgId),
        eq(schema.usageEvents.kind, 'ai_call'),
        gte(schema.usageEvents.occurredAt, monthStart),
      ];
      const rows = await ctx.db
        .select({ total: sum(schema.usageEvents.amount) })
        .from(schema.usageEvents)
        .where(and(...conditions));
      const row = rows[0];
      aiIngestsThisMonth = row?.total != null ? Number(row.total) : 0;
    } catch {
      aiIngestsThisMonth = 0;
    }

    return {
      orgId,
      plan,
      limits: {
        emulatorsMax,
        requestsPerMinute,
        aiIngestsPerMonth,
      },
      current: {
        emulators,
        requestsLast1m,
        aiIngestsThisMonth,
      },
    };
  });
}
