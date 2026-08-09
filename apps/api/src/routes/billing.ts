import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { CarbonError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { requireScope } from '../plugins/scopes.js';
import { zodBody, zodResponse } from '../plugins/schema-helpers.js';
import {
  billingEnabled,
  getStripe,
  resolvePlan,
  type BillingEnv,
  type PlanTier,
} from '../services/billing.js';

const UrlResponse = z.object({ url: z.string().nullable() });
const SubscriptionResponse = z.object({
  plan: z
    .object({
      plan: z.enum(['developer', 'team', 'enterprise']),
      status: z.string().optional(),
      seats: z.number().int().optional(),
      currentPeriodEnd: z.union([z.string(), z.date()]).nullable().optional(),
    })
    .passthrough(),
});

/**
 * Stripe billing surface.
 *
 * Four endpoints, three of which are admin-only and one — the webhook —
 * unauthenticated but signature-verified. When `STRIPE_SECRET_KEY` is unset
 * the whole surface degrades to a friendly 501 so self-hosted deployments
 * can keep running without a Stripe account.
 *
 * The webhook path installs a body-buffer content-type parser scoped to a
 * child plugin so the rest of the app keeps parsing JSON normally. Stripe
 * signature verification cannot run on an already-parsed object — it needs
 * the raw bytes.
 */

const CheckoutBody = z.object({
  plan: z.enum(['team', 'enterprise']),
  seats: z.number().int().min(1).max(500),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

const PortalBody = z.object({
  returnUrl: z.string().url(),
});

export interface BillingRouteOptions {
  /** Override env for tests (defaults to `process.env`). */
  readonly env?: BillingEnv;
  /** Override the Stripe client for tests. Takes precedence over env. */
  readonly stripe?: Stripe | null;
}

export async function registerBillingRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  opts: BillingRouteOptions = {},
): Promise<void> {
  const env: BillingEnv = opts.env ?? (process.env as unknown as BillingEnv);
  // Tests inject their own Stripe mock via `opts.stripe`; production reads
  // from env. `null` means billing is disabled — every route responds 501.
  const stripe: Stripe | null =
    opts.stripe !== undefined ? opts.stripe : getStripe(env);
  const enabled = stripe !== null && billingEnabled(env);

  const disabledReply = (reply: FastifyReply) =>
    reply.status(501).send({
      error: {
        code: 'CARBON_BILLING_DISABLED',
        message:
          'Billing is not configured on this deployment. Set STRIPE_SECRET_KEY to enable.',
      },
    });

  app.post('/v1/billing/checkout', {
    preHandler: requireScope('admin'),
    schema: {
      summary: 'Create a Stripe Checkout session',
      description:
        'Start a Stripe Checkout flow for the caller\'s org. Returns the hosted-Checkout URL. 501 if billing is disabled (no STRIPE_SECRET_KEY). Enterprise plans are sales-only and return 400.',
      body: zodBody(CheckoutBody),
      response: { 200: zodResponse(UrlResponse) },
    },
  }, async (req, reply) => {
    if (!enabled || !stripe) return disabledReply(reply);
    const body = CheckoutBody.parse(req.body);
    const orgId = requireOrgId(req);

    if (body.plan === 'enterprise') {
      // Enterprise plans are quoted, not self-serve; sending the caller to a
      // Checkout URL for that tier would just produce a broken flow.
      throw new CarbonError({
        code: 'CARBON_INVALID_INPUT',
        message: 'Enterprise plans are provisioned manually — contact sales.',
        expose: true,
      });
    }
    const priceId = env.STRIPE_PRICE_TEAM;
    if (!priceId) {
      throw new CarbonError({
        code: 'CARBON_DEPENDENCY_UNAVAILABLE',
        message: 'STRIPE_PRICE_TEAM is not set on this deployment.',
        expose: true,
      });
    }

    const customerId = await ensureCustomer(stripe, ctx, orgId);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: body.seats }],
      success_url: body.successUrl,
      cancel_url: body.cancelUrl,
      // client_reference_id lets the webhook find the org even before the
      // subscription row exists.
      client_reference_id: orgId,
      metadata: { orgId, plan: body.plan },
      subscription_data: { metadata: { orgId, plan: body.plan } },
    });

    return { url: session.url };
  });

  app.post('/v1/billing/portal', {
    preHandler: requireScope('admin'),
    schema: {
      summary: 'Create a Stripe Billing Portal session',
      description: 'Return a signed URL to the Stripe Billing Portal for the caller\'s org. 501 if billing is disabled; 404 if the org has no customer on file.',
      body: zodBody(PortalBody),
      response: { 200: zodResponse(UrlResponse) },
    },
  }, async (req, reply) => {
    if (!enabled || !stripe) return disabledReply(reply);
    const body = PortalBody.parse(req.body);
    const orgId = requireOrgId(req);

    const plan = await resolvePlan(orgId, ctx.db);
    const customerId = await lookupCustomerId(ctx, orgId);
    if (!customerId) {
      throw new CarbonError({
        code: 'CARBON_NOT_FOUND',
        message: 'No Stripe customer on file for this organization.',
        details: { orgId, plan: plan.plan },
        expose: true,
      });
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: body.returnUrl,
    });
    return { url: portal.url };
  });

  app.get(
    '/v1/billing/subscription',
    {
      preHandler: requireScope('read'),
      schema: {
        summary: 'Get the caller\'s current subscription',
        description: 'Return the resolved plan tier, status, seat count, and current period end for the caller\'s org.',
        response: { 200: zodResponse(SubscriptionResponse) },
      },
    },
    async (req) => {
      const orgId = requireOrgId(req);
      const plan = await resolvePlan(orgId, ctx.db);
      return { plan };
    },
  );

  // Webhook needs the raw request body for signature verification. Register
  // a scoped child plugin whose JSON parser hands us a Buffer, so the rest
  // of the app keeps receiving parsed objects on other routes.
  await app.register(async (scoped) => {
    scoped.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_req, body, done) => done(null, body),
    );
    scoped.post('/v1/billing/webhook', async (req, reply) => {
      if (!enabled || !stripe) return disabledReply(reply);
      const secret = env.STRIPE_WEBHOOK_SECRET;
      if (!secret) {
        return reply.status(501).send({
          error: {
            code: 'CARBON_BILLING_DISABLED',
            message: 'STRIPE_WEBHOOK_SECRET is not set on this deployment.',
          },
        });
      }
      const sig = req.headers['stripe-signature'];
      if (typeof sig !== 'string') {
        return reply
          .status(400)
          .send({ error: { code: 'CARBON_INVALID_INPUT', message: 'Missing stripe-signature header' } });
      }
      const raw = req.body as Buffer;

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(raw, sig, secret);
      } catch (err) {
        ctx.logger.warn('billing.webhook_signature_invalid', {
          message: err instanceof Error ? err.message : String(err),
        });
        return reply
          .status(400)
          .send({ error: { code: 'CARBON_INVALID_INPUT', message: 'Invalid webhook signature' } });
      }

      try {
        await handleEvent(event, ctx);
      } catch (err) {
        ctx.logger.error('billing.webhook_handler_failed', {
          type: event.type,
          id: event.id,
          message: err instanceof Error ? err.message : String(err),
        });
        // 500 asks Stripe to retry with backoff.
        return reply
          .status(500)
          .send({ error: { code: 'CARBON_INTERNAL', message: 'Webhook processing failed' } });
      }

      return { received: true };
    });
  });
}

function requireOrgId(req: FastifyRequest): string {
  const orgId = (req as AuthenticatedRequest).apiKey?.orgId;
  if (!orgId) {
    throw new CarbonError({
      code: 'CARBON_INVALID_INPUT',
      message: 'orgId is required — this route needs an authenticated API key.',
      expose: true,
    });
  }
  return orgId;
}

/**
 * Ensure a Stripe customer exists for `orgId`, creating one on demand and
 * mirroring the id into the `subscriptions` table so subsequent calls (and
 * webhook lookups) can find it without re-hitting Stripe.
 */
async function ensureCustomer(
  stripe: Stripe,
  ctx: AppContext,
  orgId: string,
): Promise<string> {
  const existing = await lookupCustomerId(ctx, orgId);
  if (existing) return existing;

  const customer = await stripe.customers.create({ metadata: { orgId } });
  await upsertSubscription(ctx, {
    orgId,
    stripeCustomerId: customer.id,
    stripeSubscriptionId: null,
    plan: 'developer',
    status: 'inactive',
    seats: 1,
    currentPeriodEnd: null,
  });
  return customer.id;
}

async function lookupCustomerId(ctx: AppContext, orgId: string): Promise<string | null> {
  const rows = await ctx.db
    .select({ stripeCustomerId: schema.subscriptions.stripeCustomerId })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.orgId, orgId))
    .limit(1);
  return rows[0]?.stripeCustomerId ?? null;
}

interface UpsertInput {
  orgId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: PlanTier;
  status: string;
  seats: number;
  currentPeriodEnd: Date | null;
}

async function upsertSubscription(ctx: AppContext, input: UpsertInput): Promise<void> {
  const now = new Date();
  // Manual read-then-insert-or-update rather than PG's ON CONFLICT so the
  // logic is the same across every drizzle backend and easy to fake in
  // tests. The `subscriptions.orgId` column has a unique constraint so a
  // concurrent duplicate insert would surface as a constraint error, not a
  // silent second row.
  const existing = await ctx.db
    .select({ id: schema.subscriptions.id })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.orgId, input.orgId))
    .limit(1);

  if (existing[0]) {
    await ctx.db
      .update(schema.subscriptions)
      .set({
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        plan: input.plan,
        status: input.status,
        seats: input.seats,
        currentPeriodEnd: input.currentPeriodEnd,
        updatedAt: now,
      })
      .where(eq(schema.subscriptions.orgId, input.orgId));
    return;
  }

  await ctx.db.insert(schema.subscriptions).values({
    id: `sub_${randomUUID()}`,
    orgId: input.orgId,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    plan: input.plan,
    status: input.status,
    seats: input.seats,
    currentPeriodEnd: input.currentPeriodEnd,
    createdAt: now,
    updatedAt: now,
  });
}

async function handleEvent(event: Stripe.Event, ctx: AppContext): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId =
        session.client_reference_id ??
        (typeof session.metadata?.orgId === 'string' ? session.metadata.orgId : null);
      if (!orgId) {
        ctx.logger.warn('billing.webhook_missing_org', { id: event.id });
        return;
      }
      const plan = readPlanFromMetadata(session.metadata) ?? 'team';
      const seats = readSeats(session);
      const customerId =
        typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
      const subscriptionId =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id ?? null;
      await upsertSubscription(ctx, {
        orgId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        plan,
        status: 'active',
        seats,
        currentPeriodEnd: null,
      });
      return;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const orgId = readOrgIdFromSubscription(sub);
      if (!orgId) {
        ctx.logger.warn('billing.webhook_missing_org', { id: event.id });
        return;
      }
      const plan = readPlanFromMetadata(sub.metadata) ?? 'team';
      const seats = sub.items?.data?.[0]?.quantity ?? 1;
      const currentPeriodEnd = subscriptionPeriodEnd(sub);
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      await upsertSubscription(ctx, {
        orgId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
        plan,
        status: sub.status,
        seats,
        currentPeriodEnd,
      });
      return;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const orgId = readOrgIdFromSubscription(sub);
      if (!orgId) {
        ctx.logger.warn('billing.webhook_missing_org', { id: event.id });
        return;
      }
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      await upsertSubscription(ctx, {
        orgId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
        plan: 'developer',
        status: 'canceled',
        seats: 1,
        currentPeriodEnd: subscriptionPeriodEnd(sub),
      });
      return;
    }
    default:
      // Every other Stripe event type is ignored, on purpose — mirroring the
      // subset we actively use keeps the surface small and the webhook fast.
      return;
  }
}

function readPlanFromMetadata(metadata: Stripe.Metadata | null | undefined): PlanTier | null {
  const raw = metadata?.plan;
  if (raw === 'developer' || raw === 'team' || raw === 'enterprise') return raw;
  return null;
}

function readSeats(session: Stripe.Checkout.Session): number {
  const items = session.line_items?.data;
  if (items && items.length > 0 && items[0]?.quantity) return items[0].quantity;
  // Checkout sessions don't always inline line items; fall back to 1 seat and
  // let the subsequent `customer.subscription.updated` event correct it.
  return 1;
}

function readOrgIdFromSubscription(sub: Stripe.Subscription): string | null {
  const meta = sub.metadata?.orgId;
  if (typeof meta === 'string' && meta.length > 0) return meta;
  return null;
}

function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  // `current_period_end` moved onto individual subscription items in newer
  // API versions; look in both places.
  const rootEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
  if (typeof rootEnd === 'number') return new Date(rootEnd * 1000);
  const itemEnd = (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)
    ?.current_period_end;
  if (typeof itemEnd === 'number') return new Date(itemEnd * 1000);
  return null;
}
