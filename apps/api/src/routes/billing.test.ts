import { describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type Stripe from 'stripe';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { registerBillingRoutes } from './billing.js';
import { requireActivePlan } from '../services/billing.js';

function errStatus(code: string): number {
  switch (code) {
    case 'CARBON_FORBIDDEN':
      return 403;
    case 'CARBON_NOT_FOUND':
      return 404;
    case 'CARBON_INVALID_INPUT':
      return 400;
    default:
      return 500;
  }
}

/**
 * Billing routes are exercised against a fully in-memory Stripe stub and a
 * tiny fake of the `subscriptions` table. We don't try to reproduce Drizzle's
 * SQL AST — the routes only ever hit one table and three verbs, so we can
 * fake it directly and assert on rows.
 */

interface SubRow {
  id: string;
  orgId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: 'developer' | 'team' | 'enterprise';
  status: string;
  seats: number;
  currentPeriodEnd: Date | null;
}

function makeDb(): { db: AppContext['db']; rows: SubRow[] } {
  const rows: SubRow[] = [];
  // The routes issue at most:
  //   select({...}).from(subscriptions).where(eq(orgId, X)).limit(1)
  //   insert(subscriptions).values(row)
  //   update(subscriptions).set(patch).where(eq(orgId, X))
  // We fake by tracking the last orgId that .where() was called against via
  // a module-scope handle passed to every chain call. Since the routes never
  // interleave queries within a single request that could confuse this, we
  // rely on ordering: the current test uses one request at a time.
  let pendingOrgId: string | null = null;

  const db = {
    select: () => ({
      from: () => ({
        where: (predicate: unknown) => {
          // Every call site is `eq(subscriptions.orgId, orgId)`; snoop the
          // orgId by walking drizzle's SQL chunks. In practice the value
          // ends up as one of the chunks' `.value`.
          pendingOrgId = extractValue(predicate);
          return {
            limit: async () => {
              const row = rows.find((r) => r.orgId === pendingOrgId);
              return row ? [row] : [];
            },
          };
        },
      }),
    }),
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        // The webhook path also inserts into `processed_stripe_events` for
        // dedupe; those rows have neither `orgId` nor `plan`. Only mirror
        // real subscription writes into the test's `rows` fake.
        if ('orgId' in v && 'plan' in v) {
          rows.push({ ...(v as unknown as SubRow) });
        }
      },
    }),
    update: () => {
      let patch: Partial<SubRow> = {};
      return {
        set: (p: Partial<SubRow>) => {
          patch = p;
          return {
            where: async (predicate: unknown) => {
              const orgId = extractValue(predicate);
              for (const r of rows) {
                if (r.orgId === orgId) Object.assign(r, patch);
              }
            },
          };
        },
      };
    },
  } as unknown as AppContext['db'];

  return { db, rows };
}

// Drizzle's `eq(col, value)` returns an SQL wrapper. Rather than depend on
// its private shape, we walk the object graph looking for the first string
// value that looks like an orgId (or whatever was passed in). Good enough
// for the two call shapes billing.ts uses.
function extractValue(node: unknown): string | null {
  if (typeof node === 'string') return node;
  if (!node || typeof node !== 'object') return null;
  const stack: unknown[] = [node];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
    seen.add(cur);
    for (const val of Object.values(cur as Record<string, unknown>)) {
      if (typeof val === 'string' && val.length > 0 && !isSqlNoise(val)) return val;
      if (val && typeof val === 'object') stack.push(val);
    }
  }
  return null;
}

function isSqlNoise(s: string): boolean {
  return (
    s === '=' ||
    s === 'subscriptions' ||
    s === 'org_id' ||
    s === 'orgId' ||
    s === 'and' ||
    s.length < 3
  );
}

function makeCtx(db: AppContext['db']): AppContext {
  return {
    logger: NoopLogger,
    db,
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

/**
 * Minimal Stripe stub. Only implements what the routes call. Every method
 * records its args so tests can assert on them.
 */
function makeStripeStub(overrides: Partial<Record<string, unknown>> = {}) {
  const calls = {
    createCustomer: [] as unknown[],
    createSession: [] as unknown[],
    createPortal: [] as unknown[],
    constructEvent: [] as unknown[],
  };
  const stripe = {
    customers: {
      create: async (args: unknown) => {
        calls.createCustomer.push(args);
        return { id: 'cus_test_123' };
      },
    },
    checkout: {
      sessions: {
        create: async (args: unknown) => {
          calls.createSession.push(args);
          return { url: 'https://checkout.stripe.test/session/xyz' };
        },
      },
    },
    billingPortal: {
      sessions: {
        create: async (args: unknown) => {
          calls.createPortal.push(args);
          return { url: 'https://portal.stripe.test/session/xyz' };
        },
      },
    },
    webhooks: {
      constructEvent: (payload: Buffer, signature: string, secret: string) => {
        calls.constructEvent.push({ payload, signature, secret });
        if (overrides.constructEvent) {
          return (overrides.constructEvent as (...a: unknown[]) => unknown)(
            payload,
            signature,
            secret,
          );
        }
        throw new Error('constructEvent not stubbed');
      },
    },
  };
  return { stripe: stripe as unknown as Stripe, calls };
}

/**
 * Build a Fastify app with billing routes registered and a fake API key on
 * every request so `requireScope('admin')` and the org-lookup helper both
 * succeed.
 */
async function buildApp(opts: {
  ctx: AppContext;
  stripe: Stripe | null;
  env?: { STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string; STRIPE_PRICE_TEAM?: string };
  orgId?: string;
  scopes?: string[];
}): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (isCarbonError(err)) {
      reply
        .status(errStatus(err.code))
        .send({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
  });
  app.addHook('onRequest', async (req) => {
    (req as AuthenticatedRequest).apiKey = {
      id: 'key_test',
      orgId: opts.orgId ?? 'org_test_1',
      prefix: 'ck_test',
      scopes: opts.scopes ?? ['admin'],
      projectIds: null,
      expiresAt: null,
    };
  });
  await registerBillingRoutes(app, opts.ctx, {
    env: opts.env ?? {
      STRIPE_SECRET_KEY: 'sk_test',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      STRIPE_PRICE_TEAM: 'price_team_test',
    },
    stripe: opts.stripe,
  });
  return app;
}

describe('billing routes', () => {
  it('checkout returns the Stripe session url', async () => {
    const { db, rows } = makeDb();
    const ctx = makeCtx(db);
    const { stripe, calls } = makeStripeStub();
    const app = await buildApp({ ctx, stripe });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      payload: {
        plan: 'team',
        seats: 3,
        successUrl: 'https://app.test/success',
        cancelUrl: 'https://app.test/cancel',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: 'https://checkout.stripe.test/session/xyz' });
    expect(calls.createCustomer).toHaveLength(1);
    expect(calls.createSession).toHaveLength(1);
    // A row was created to remember the customer id ahead of the webhook.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.stripeCustomerId).toBe('cus_test_123');
    expect(rows[0]?.orgId).toBe('org_test_1');
  });

  it('portal returns the Stripe portal url once a customer exists', async () => {
    const { db, rows } = makeDb();
    rows.push({
      id: 'sub_seed',
      orgId: 'org_test_1',
      stripeCustomerId: 'cus_seed',
      stripeSubscriptionId: null,
      plan: 'team',
      status: 'active',
      seats: 1,
      currentPeriodEnd: null,
    });
    const ctx = makeCtx(db);
    const { stripe, calls } = makeStripeStub();
    const app = await buildApp({ ctx, stripe });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/portal',
      payload: { returnUrl: 'https://app.test/settings/billing' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: 'https://portal.stripe.test/session/xyz' });
    expect(calls.createPortal).toHaveLength(1);
  });

  it('webhook rejects an invalid signature with 400', async () => {
    const { db } = makeDb();
    const ctx = makeCtx(db);
    const { stripe } = makeStripeStub({
      constructEvent: () => {
        throw new Error('signature mismatch');
      },
    });
    const app = await buildApp({ ctx, stripe });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/webhook',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=1,v1=bogus',
      },
      payload: JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' }),
    });

    expect(res.statusCode).toBe(400);
  });

  it('webhook upserts subscription row on checkout.session.completed', async () => {
    const { db, rows } = makeDb();
    const ctx = makeCtx(db);
    const event = {
      id: 'evt_2',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'org_paid_1',
          customer: 'cus_paid_1',
          subscription: 'sub_paid_1',
          metadata: { orgId: 'org_paid_1', plan: 'team' },
          line_items: { data: [{ quantity: 5 }] },
        },
      },
    };
    const { stripe } = makeStripeStub({ constructEvent: () => event });
    const app = await buildApp({ ctx, stripe });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/webhook',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=1,v1=ok',
      },
      payload: JSON.stringify(event),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.orgId).toBe('org_paid_1');
    expect(row.plan).toBe('team');
    expect(row.status).toBe('active');
    expect(row.seats).toBe(5);
    expect(row.stripeCustomerId).toBe('cus_paid_1');
    expect(row.stripeSubscriptionId).toBe('sub_paid_1');
  });

  it('requireActivePlan blocks inactive orgs and passes active-team ones', async () => {
    const { db, rows } = makeDb();
    // Two orgs: one inactive, one on active team. Same preHandler gates
    // both requests so the check itself is what changes behavior.
    rows.push({
      id: 'sub_inactive',
      orgId: 'org_inactive',
      stripeCustomerId: 'cus_a',
      stripeSubscriptionId: null,
      plan: 'developer',
      status: 'inactive',
      seats: 1,
      currentPeriodEnd: null,
    });
    rows.push({
      id: 'sub_active',
      orgId: 'org_active',
      stripeCustomerId: 'cus_b',
      stripeSubscriptionId: 'sub_1',
      plan: 'team',
      status: 'active',
      seats: 3,
      currentPeriodEnd: null,
    });
    const ctx = makeCtx(db);

    const buildProbe = async (orgId: string) => {
      const app = Fastify();
      app.setErrorHandler((err, _req, reply) => {
        if (isCarbonError(err)) {
          reply
            .status(errStatus(err.code))
            .send({ error: { code: err.code, message: err.message } });
          return;
        }
        reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
      });
      app.addHook('onRequest', async (req) => {
        (req as AuthenticatedRequest).apiKey = {
          id: 'key',
          orgId,
          prefix: 'ck_test',
          scopes: ['admin'],
          projectIds: null,
          expiresAt: null,
        };
      });
      app.get(
        '/team-only',
        {
          preHandler: requireActivePlan('team', {
            ctx,
            env: { STRIPE_SECRET_KEY: 'sk_test' },
          }),
        },
        async () => ({ ok: true }),
      );
      return app;
    };

    const blocked = await (
      await buildProbe('org_inactive')
    ).inject({ method: 'GET', url: '/team-only' });
    expect(blocked.statusCode).toBe(403);

    const allowed = await (
      await buildProbe('org_active')
    ).inject({ method: 'GET', url: '/team-only' });
    expect(allowed.statusCode).toBe(200);
  });

  it('returns 501 on every endpoint when billing is disabled', async () => {
    const { db } = makeDb();
    const ctx = makeCtx(db);
    const app = await buildApp({ ctx, stripe: null, env: {} });

    for (const path of ['/v1/billing/checkout', '/v1/billing/portal']) {
      const res = await app.inject({
        method: 'POST',
        url: path,
        payload: {
          plan: 'team',
          seats: 1,
          successUrl: 'https://x.test/s',
          cancelUrl: 'https://x.test/c',
          returnUrl: 'https://x.test/r',
        },
      });
      expect(res.statusCode).toBe(501);
    }
  });
});

// Silence the noisy signature-invalid log line during the negative-path test.
vi.spyOn(console, 'error').mockImplementation(() => {});
