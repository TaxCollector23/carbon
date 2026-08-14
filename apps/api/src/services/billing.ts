import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { CarbonError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';

/**
 * Billing is *optional*. Every entry point here is safe when
 * `STRIPE_SECRET_KEY` is unset — dev boxes, self-hosted deploys, and CI all
 * boot without a Stripe account.
 *
 *  - `getStripe(env)` returns null when disabled; routes must respond 501.
 *  - `resolvePlan(orgId, db)` reads the mirrored `subscriptions` row and
 *    defaults to the free `developer` plan when nothing has been provisioned.
 *  - `requireActivePlan(plan)` is a Fastify preHandler; when billing is
 *    disabled it is a no-op so that gated features stay usable on
 *    self-hosted installs.
 */

export type PlanTier = 'developer' | 'team' | 'enterprise';

export interface BillingEnv {
  readonly STRIPE_SECRET_KEY?: string;
  readonly STRIPE_WEBHOOK_SECRET?: string;
  readonly STRIPE_PRICE_TEAM?: string;
}

export interface ResolvedPlan {
  readonly plan: PlanTier;
  readonly status: string;
  readonly seats: number;
  readonly currentPeriodEnd: Date | null;
}

export const DEFAULT_PLAN: ResolvedPlan = {
  plan: 'developer',
  status: 'inactive',
  seats: 1,
  currentPeriodEnd: null,
};

/**
 * Build a Stripe client from environment. Returns `null` when the secret is
 * unset so callers can shape a friendly 501 rather than an obscure crash at
 * boot. Pinned API version so a Stripe library upgrade cannot silently change
 * webhook payload shapes underneath us.
 */
export function getStripe(env: BillingEnv): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-02-24.acacia',
    typescript: true,
  });
}

export function billingEnabled(env: BillingEnv): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

/** Read the mirrored subscription row, defaulting to the free tier. */
export async function resolvePlan(orgId: string, db: AppContext['db']): Promise<ResolvedPlan> {
  const rows = await db
    .select({
      plan: schema.subscriptions.plan,
      status: schema.subscriptions.status,
      seats: schema.subscriptions.seats,
      currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
    })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.orgId, orgId))
    .limit(1);
  const row = rows[0];
  if (!row) return DEFAULT_PLAN;
  return {
    plan: row.plan as PlanTier,
    status: row.status,
    seats: row.seats,
    currentPeriodEnd: row.currentPeriodEnd ?? null,
  };
}

interface RequireActivePlanOptions {
  readonly ctx: AppContext;
  readonly env: BillingEnv;
}

/**
 * Fastify preHandler factory. Gates a route on the caller's org holding an
 * active subscription at (or above) the requested tier.
 *
 * - Billing disabled → no-op, so self-hosted / dev keeps working.
 * - No org on request → no-op (auth-disabled dev boxes).
 * - `enterprise` implies every lower tier; `team` gates require `team` or
 *   `enterprise` and `status === 'active'`.
 */
export function requireActivePlan(
  required: Exclude<PlanTier, 'developer'>,
  opts: RequireActivePlanOptions,
): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (!billingEnabled(opts.env)) return;
    const orgId = (req as AuthenticatedRequest).apiKey?.orgId;
    if (!orgId) return;
    const plan = await resolvePlan(orgId, opts.ctx.db);
    if (plan.status !== 'active') {
      throw new CarbonError({
        code: 'CARBON_FORBIDDEN',
        message: `This feature requires an active ${required} subscription.`,
        details: { required, held: plan.plan, status: plan.status },
        expose: true,
      });
    }
    if (!planSatisfies(plan.plan, required)) {
      throw new CarbonError({
        code: 'CARBON_FORBIDDEN',
        message: `This feature requires the ${required} plan or higher.`,
        details: { required, held: plan.plan },
        expose: true,
      });
    }
  };
}

const PLAN_RANK: Record<PlanTier, number> = {
  developer: 0,
  team: 1,
  enterprise: 2,
};

export function planSatisfies(held: PlanTier, required: PlanTier): boolean {
  return PLAN_RANK[held] >= PLAN_RANK[required];
}
