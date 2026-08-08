import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { schema } from '@carbon/database';
import { CarbonError } from '@carbon/core';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import type { SessionAuthenticatedRequest } from '../plugins/session-auth.js';

/**
 * `GET /v1/me` — identity introspection for both auth paths.
 *
 * Returns a compact view of "who am I talking to right now" so the CLI's
 * `carbon whoami`, the dashboard header, and support triage all read from a
 * single endpoint instead of piecing it together from api-keys / memberships /
 * organizations / subscriptions.
 *
 * Prefers the API-key path when both are present (matches project-access.ts).
 */
export async function registerMeRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get('/v1/me', async (req) => {
    const apiKey = (req as AuthenticatedRequest).apiKey;
    const sessionUser = (req as SessionAuthenticatedRequest).sessionUser;

    if (!apiKey && !sessionUser) {
      throw new CarbonError({
        code: 'CARBON_UNAUTHENTICATED',
        message: 'No API key or session',
        expose: true,
      });
    }

    const orgId = apiKey?.orgId ?? sessionUser?.orgId;
    let org: { id: string; name: string; slug: string } | null = null;
    if (orgId) {
      const [row] = await ctx.db
        .select({
          id: schema.organizations.id,
          name: schema.organizations.name,
          slug: schema.organizations.slug,
        })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, orgId))
        .limit(1);
      if (row) org = row;
    }

    let plan: string | null = null;
    if (orgId) {
      try {
        const [sub] = await ctx.db
          .select({ plan: schema.subscriptions.plan, status: schema.subscriptions.status })
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.orgId, orgId))
          .limit(1);
        if (sub) plan = sub.status === 'active' ? sub.plan : `${sub.plan}:${sub.status}`;
      } catch {
        // Subscriptions table may not exist in older deployments; report null.
        plan = null;
      }
    }

    let role: string | null = null;
    if (sessionUser?.id && orgId) {
      const [m] = await ctx.db
        .select({ role: schema.memberships.role })
        .from(schema.memberships)
        .where(
          and(eq(schema.memberships.userId, sessionUser.id), eq(schema.memberships.orgId, orgId)),
        )
        .limit(1);
      if (m) role = m.role;
    }

    return {
      user: sessionUser
        ? { id: sessionUser.id, email: sessionUser.email, role }
        : null,
      key: apiKey
        ? { id: apiKey.id, prefix: apiKey.prefix, scopes: apiKey.scopes }
        : null,
      org,
      plan,
    };
  });
}
