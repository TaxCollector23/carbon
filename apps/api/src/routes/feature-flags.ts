import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CarbonError } from '@carbon/core';
import type { AppContext } from '../context.js';
import type { SessionAuthenticatedRequest } from '../plugins/session-auth.js';
import { resolveCallerOrg } from '../plugins/caller-org.js';
import { requireScope } from '../plugins/scopes.js';
import { zodBody, zodResponse, zodResponseWithExample } from '../plugins/schema-helpers.js';
import { resolvePlan, type PlanTier } from '../services/billing.js';
import {
  listFlags,
  seedBuiltInFlags,
  setFlag,
  type FlagResolutionContext,
} from '../services/feature-flags.js';

const ScopeEnum = z.enum(['org', 'user', 'plan']);

const OverrideView = z.object({
  scope: ScopeEnum,
  scopeId: z.string(),
  value: z.boolean(),
});
const FlagView = z.object({
  key: z.string(),
  description: z.string().nullable(),
  defaultValue: z.boolean(),
  effective: z.boolean(),
  overrides: z.array(OverrideView),
});
const FlagListResponse = z.object({ data: z.array(FlagView) });

const PatchBody = z.object({
  scope: ScopeEnum,
  scopeId: z.string().min(1).max(200),
  value: z.boolean(),
});

async function resolveCallerScope(
  ctx: AppContext,
  req: FastifyRequest,
): Promise<FlagResolutionContext> {
  const session = (req as SessionAuthenticatedRequest).sessionUser;
  const orgId = resolveCallerOrg(req, { mode: 'optional' }) ?? null;
  const userId = session?.id ?? null;
  let plan: PlanTier | null = null;
  if (orgId) {
    try {
      const p = await resolvePlan(orgId, ctx.db);
      plan = p.plan;
    } catch {
      plan = null;
    }
  }
  return { orgId, userId, plan };
}

export async function registerFeatureFlagRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get(
    '/v1/feature-flags',
    {
      preHandler: requireScope('read'),
      schema: {
        summary: 'List feature flags',
        description:
          'Return every flag definition plus the overrides that apply to the caller (org, user, plan). ' +
          "The `effective` field is pre-computed against the caller's scope so a UI row is one fetch.",
        response: {
          200: zodResponseWithExample(FlagListResponse, {
            data: [
              {
                key: 'ai_quality_judge',
                description: 'Run the LLM judge on every ingest to produce an AI-quality score.',
                defaultValue: false,
                effective: true,
                overrides: [
                  { scope: 'org', scopeId: 'org_01HXK5H7Q9C0R3Q1S8V6M4WJZK', value: true },
                ],
              },
              {
                key: 'sse_events_stream',
                description: 'Enable /v1/events/stream Server-Sent Events endpoint.',
                defaultValue: true,
                effective: true,
                overrides: [],
              },
            ],
          }),
        },
      },
    },
    async (req) => {
      // Lazy seed on first read so a fresh deploy has the built-in flag rows
      // even if no admin has explicitly created any overrides yet.
      await seedBuiltInFlags(ctx);
      const scope = await resolveCallerScope(ctx, req);
      const flags = await listFlags(ctx, scope);
      return { data: flags };
    },
  );

  app.patch<{ Params: { key: string } }>(
    '/v1/feature-flags/:key',
    {
      preHandler: requireScope('admin'),
      schema: {
        summary: 'Set a feature flag override',
        description:
          'Admin-only. Upsert an override for the given flag key at the specified scope ' +
          '(`org`, `user`, or `plan`). `scopeId` is the org id, user id, or plan tier respectively.',
        body: zodBody(PatchBody),
        response: { 200: zodResponse(OverrideView) },
      },
    },
    async (req) => {
      const body = PatchBody.parse(req.body ?? {});
      await seedBuiltInFlags(ctx);
      // For `org` scope, refuse to write for an org other than the caller's own
      // (session role + api-key scope are already checked, but an admin key on
      // org A must not be able to flip a flag for org B).
      const callerOrgId = resolveCallerOrg(req, { mode: 'optional' }) ?? null;
      if (body.scope === 'org' && callerOrgId && body.scopeId !== callerOrgId) {
        throw new CarbonError({
          code: 'CARBON_FORBIDDEN',
          message: 'Cannot set an org-scoped flag for a different organization',
          expose: true,
        });
      }
      return setFlag(ctx, req.params.key, body.scope, body.scopeId, body.value);
    },
  );
}
