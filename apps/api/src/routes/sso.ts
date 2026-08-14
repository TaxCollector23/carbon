import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { CarbonError, makeId, NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import { resolveCallerOrg } from '../plugins/caller-org.js';
import { requireScope } from '../plugins/scopes.js';
import { zodBody, zodResponse } from '../plugins/schema-helpers.js';
import { getActor, recordEvent } from '../services/events.js';

const ProviderView = z.object({
  id: z.string(),
  type: z.enum(['saml', 'oidc']),
  name: z.string(),
  emailDomain: z.string().optional(),
  config: z.record(z.unknown()),
  createdAt: z.string(),
});
const ProviderListResponse = z.object({ data: z.array(ProviderView) });

/**
 * SSO provider management — SAML and OIDC. Stored inside the
 * `organizations.settings.ssoProviders` jsonb array so we don't need another
 * migration; enforcement of the login flow itself is deferred until the
 * Better Auth SSO plugin ships in a version this workspace can install.
 *
 * Enterprise-only. A non-enterprise org attempting to configure SSO gets a
 * 403 with an actionable message rather than a silent 200.
 */

const SamlConfig = z.object({
  type: z.literal('saml'),
  name: z.string().min(1).max(120),
  entityId: z.string().min(1).max(500),
  ssoUrl: z.string().url(),
  certificate: z.string().min(10).max(20_000),
  emailDomain: z.string().min(1).max(200).optional(),
});

const OidcConfig = z.object({
  type: z.literal('oidc'),
  name: z.string().min(1).max(120),
  issuer: z.string().url(),
  clientId: z.string().min(1).max(500),
  clientSecret: z.string().min(1).max(500),
  emailDomain: z.string().min(1).max(200).optional(),
});

const ProviderBody = z.discriminatedUnion('type', [SamlConfig, OidcConfig]);

interface StoredProvider {
  readonly id: string;
  readonly type: 'saml' | 'oidc';
  readonly name: string;
  readonly emailDomain?: string;
  readonly config: Record<string, unknown>;
  readonly createdAt: string;
}

interface OrgSettings {
  ssoProviders?: StoredProvider[];
  [key: string]: unknown;
}

export async function registerSsoRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get(
    '/v1/sso/providers',
    {
      preHandler: requireScope('admin'),
      schema: {
        summary: 'List SSO providers',
        description:
          "Return every SAML/OIDC provider configured for the caller's org. Client secrets are stripped from the response.",
        response: { 200: zodResponse(ProviderListResponse) },
      },
    },
    async (req) => {
      const orgId = resolveCallerOrg(req);
      const org = await loadOrg(ctx, orgId);
      return { data: (org.settings.ssoProviders ?? []).map(publicView) };
    },
  );

  app.post(
    '/v1/sso/providers',
    {
      preHandler: requireScope('admin'),
      schema: {
        summary: 'Configure an SSO provider',
        description:
          'Add a SAML or OIDC provider to the org. Enterprise-only — non-enterprise orgs get 403. OIDC client secrets are stored but never returned.',
        body: zodBody(ProviderBody),
        response: { 201: zodResponse(ProviderView) },
      },
    },
    async (req, reply) => {
      const body = ProviderBody.parse(req.body);
      const orgId = resolveCallerOrg(req);
      const org = await loadOrg(ctx, orgId);
      if (!org.isEnterprise) {
        throw new CarbonError({
          code: 'CARBON_FORBIDDEN',
          message: 'SSO is available on Enterprise plans only',
          expose: true,
        });
      }
      const id = makeId('sso');
      const provider: StoredProvider = {
        id,
        type: body.type,
        name: body.name,
        emailDomain: body.emailDomain,
        config: providerConfig(body),
        createdAt: new Date().toISOString(),
      };
      const existing = org.settings.ssoProviders ?? [];
      const nextSettings: OrgSettings = {
        ...org.settings,
        ssoProviders: [...existing, provider],
      };
      await ctx.db
        .update(schema.organizations)
        .set({ settings: nextSettings })
        .where(eq(schema.organizations.id, orgId));

      const actor = getActor(req);
      await recordEvent(ctx, {
        orgId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'sso_provider.created',
        metadata: { id, type: body.type, name: body.name },
      });
      reply.status(201);
      return publicView(provider);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/v1/sso/providers/:id',
    {
      preHandler: requireScope('admin'),
      schema: {
        summary: 'Remove an SSO provider',
        description: 'Delete the provider by id from the org. 404 if the id is not configured.',
      },
    },
    async (req, reply) => {
      const orgId = resolveCallerOrg(req);
      const org = await loadOrg(ctx, orgId);
      const existing = org.settings.ssoProviders ?? [];
      const filtered = existing.filter((p) => p.id !== req.params.id);
      if (filtered.length === existing.length) {
        throw new NotFoundError('sso_provider', req.params.id);
      }
      const nextSettings: OrgSettings = { ...org.settings, ssoProviders: filtered };
      await ctx.db
        .update(schema.organizations)
        .set({ settings: nextSettings })
        .where(eq(schema.organizations.id, orgId));
      const actor = getActor(req);
      await recordEvent(ctx, {
        orgId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'sso_provider.deleted',
        metadata: { id: req.params.id },
      });
      reply.status(204).send();
    },
  );
}

function providerConfig(body: z.infer<typeof ProviderBody>): Record<string, unknown> {
  if (body.type === 'saml') {
    return {
      entityId: body.entityId,
      ssoUrl: body.ssoUrl,
      certificate: body.certificate,
    };
  }
  return {
    issuer: body.issuer,
    clientId: body.clientId,
    // Never returned by GET, but stored so a future SSO enforcer can read it.
    clientSecret: body.clientSecret,
  };
}

function publicView(p: StoredProvider): Omit<StoredProvider, 'config'> & {
  config: Record<string, unknown>;
} {
  // Strip the OIDC client secret from list/create responses. The stored copy
  // stays put so a future Better Auth SSO plugin can pick it up.
  const { config, ...rest } = p;
  const sanitized: Record<string, unknown> = { ...config };
  if ('clientSecret' in sanitized) delete sanitized.clientSecret;
  return { ...rest, config: sanitized };
}

async function loadOrg(
  ctx: AppContext,
  orgId: string,
): Promise<{ isEnterprise: boolean; settings: OrgSettings }> {
  const [row] = await ctx.db
    .select({
      isEnterprise: schema.organizations.isEnterprise,
      settings: schema.organizations.settings,
    })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId))
    .limit(1);
  if (!row) throw new NotFoundError('organization', orgId);
  return {
    isEnterprise: Boolean(row.isEnterprise),
    settings: (row.settings ?? {}) as OrgSettings,
  };
}
