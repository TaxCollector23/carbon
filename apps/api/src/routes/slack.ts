import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { CarbonError, NotFoundError, makeId } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import type { SessionAuthenticatedRequest } from '../plugins/session-auth.js';
import { resolveCallerOrg } from '../plugins/caller-org.js';
import { requireScope } from '../plugins/scopes.js';
import { zodBody, zodResponse } from '../plugins/schema-helpers.js';
import { getActor, recordEvent } from '../services/events.js';
import {
  defaultSlackApi,
  decryptSlackToken,
  encryptSlackToken,
  slackInstallUrl,
  SLACK_OAUTH_SCOPES,
  type SlackApiClient,
} from '../services/slack.js';

/**
 * Real Slack-app installation + per-channel event subscription routes.
 *
 *   GET  /v1/slack/install           → 302 to Slack's OAuth authorize page
 *   GET  /v1/slack/oauth-callback    → exchanges `code`, stores installation
 *   GET  /v1/slack/installations     → list caller-org installations
 *   POST /v1/slack/subscriptions     → attach a channel to an installation
 *   DELETE /v1/slack/subscriptions/:id
 *   DELETE /v1/slack/installations/:id
 *
 * Everything except `/install` and `/oauth-callback` requires an admin-scoped
 * caller. The OAuth endpoints run before session/api-key auth is enforced —
 * they're the entry point for an admin coming from the dashboard.
 */

export const SLACK_PUBLIC_PATHS: readonly string[] = [
  '/v1/slack/install',
  '/v1/slack/oauth-callback',
];

const InstallationView = z.object({
  id: z.string(),
  orgId: z.string(),
  teamId: z.string(),
  teamName: z.string(),
  botUserId: z.string().nullable(),
  appId: z.string().nullable(),
  installedBy: z.string().nullable(),
  installedAt: z.string(),
});
const InstallationListResponse = z.object({ data: z.array(InstallationView) });

const SubscriptionView = z.object({
  id: z.string(),
  installationId: z.string(),
  channelId: z.string(),
  channelName: z.string(),
  events: z.array(z.string()),
  createdAt: z.string(),
});
const SubscriptionListResponse = z.object({ data: z.array(SubscriptionView) });

const SubscriptionBody = z.object({
  installationId: z.string().min(1).max(200),
  channelId: z.string().min(1).max(200),
  channelName: z.string().min(1).max(200),
  events: z.array(z.string().min(1).max(200)).min(1).max(100),
});

export interface SlackRoutesOptions {
  /** Injectable Slack API client — tests supply a stub. */
  readonly slackApi?: SlackApiClient;
  /**
   * Overrides for env-driven config so tests don't need to poke process.env.
   * When absent the values are read lazily at request time.
   */
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly redirectUri?: string;
  readonly dashboardUrl?: string;
}

interface Config {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  dashboardUrl: string;
}

function loadConfig(opts: SlackRoutesOptions): Config {
  const clientId = opts.clientId ?? process.env.SLACK_CLIENT_ID ?? '';
  const clientSecret = opts.clientSecret ?? process.env.SLACK_CLIENT_SECRET ?? '';
  const redirectUri =
    opts.redirectUri ??
    process.env.SLACK_REDIRECT_URI ??
    `${(process.env.API_PUBLIC_URL ?? 'http://localhost:4000').replace(/\/$/, '')}/v1/slack/oauth-callback`;
  const dashboardUrl = (
    opts.dashboardUrl ??
    process.env.DASHBOARD_URL ??
    'http://localhost:3001'
  ).replace(/\/$/, '');
  return { clientId, clientSecret, redirectUri, dashboardUrl };
}

async function requireAdminForOrg(
  ctx: AppContext,
  req: FastifyRequest,
  orgId: string,
): Promise<void> {
  const apiKey = (req as AuthenticatedRequest).apiKey;
  if (apiKey) {
    if (apiKey.orgId !== orgId) {
      throw new CarbonError({
        code: 'CARBON_FORBIDDEN',
        message: 'API key not scoped to this organization',
        expose: true,
      });
    }
    if (!apiKey.scopes.includes('admin')) {
      throw new CarbonError({
        code: 'CARBON_FORBIDDEN',
        message: 'Slack integration management requires an admin-scoped key',
        expose: true,
      });
    }
    return;
  }
  const session = (req as SessionAuthenticatedRequest).sessionUser;
  if (session) {
    const [row] = await ctx.db
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.userId, session.id), eq(schema.memberships.orgId, orgId)))
      .limit(1);
    if (!row || (row.role !== 'owner' && row.role !== 'admin')) {
      throw new CarbonError({
        code: 'CARBON_FORBIDDEN',
        message: 'Owner or admin role required to manage Slack integrations',
        expose: true,
      });
    }
    return;
  }
  // Auth disabled (dev): permit — matches organizations.ts posture.
}

export async function registerSlackRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  opts: SlackRoutesOptions = {},
): Promise<void> {
  const slackApi = opts.slackApi ?? defaultSlackApi;

  // --------------------------------------------------------------------------
  // OAuth entry: bounce the browser to Slack.
  // --------------------------------------------------------------------------
  app.get<{ Querystring: { orgId?: string; state?: string } }>(
    '/v1/slack/install',
    {
      schema: {
        summary: 'Begin Slack app installation',
        description:
          "Redirects the caller to Slack's OAuth authorize page with the " +
          '`channels:read chat:write incoming-webhook` scopes. The `state` ' +
          'parameter carries the org id back to the callback so the installation ' +
          'is attributed correctly.',
      },
    },
    async (req, reply) => {
      const cfg = loadConfig(opts);
      if (!cfg.clientId) {
        throw new CarbonError({
          code: 'CARBON_INVALID_INPUT',
          message: 'Slack integration is not configured on this server (SLACK_CLIENT_ID unset)',
          expose: true,
        });
      }
      // Prefer session/api-key-derived org so a signed-in admin doesn't need to
      // spoon-feed the query. Falls back to explicit ?orgId= for the dev flow.
      const callerOrg = resolveCallerOrg(req, { mode: 'optional', queryOrg: req.query.orgId });
      const state = req.query.state ?? `${callerOrg ?? 'unknown'}:${makeId('slk_state', 12)}`;
      const url = slackInstallUrl({
        clientId: cfg.clientId,
        redirectUri: cfg.redirectUri,
        state,
        scopes: SLACK_OAUTH_SCOPES,
      });
      reply.redirect(url, 302);
    },
  );

  // --------------------------------------------------------------------------
  // OAuth callback: swap code → token, persist an installation row.
  // --------------------------------------------------------------------------
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/v1/slack/oauth-callback',
    {
      schema: {
        summary: 'Slack OAuth callback',
        description:
          'Exchanges the auth code for a bot token and stores an encrypted installation row.',
      },
    },
    async (req, reply) => {
      const cfg = loadConfig(opts);
      if (req.query.error) {
        throw new CarbonError({
          code: 'CARBON_INVALID_INPUT',
          message: `Slack denied the install: ${req.query.error}`,
          expose: true,
        });
      }
      const code = req.query.code;
      if (!code) {
        throw new CarbonError({
          code: 'CARBON_INVALID_INPUT',
          message: 'Missing `code` parameter from Slack callback',
          expose: true,
        });
      }
      if (!cfg.clientId || !cfg.clientSecret) {
        throw new CarbonError({
          code: 'CARBON_INVALID_INPUT',
          message:
            'Slack integration is not configured (SLACK_CLIENT_ID / SLACK_CLIENT_SECRET unset)',
          expose: true,
        });
      }

      // state encodes "<orgId>:<nonce>"; unknown orgs fall back to the
      // caller's session-derived org, otherwise reject.
      const [statedOrgId] = (req.query.state ?? '').split(':');
      const orgId =
        statedOrgId && statedOrgId !== 'unknown'
          ? statedOrgId
          : resolveCallerOrg(req, { mode: 'optional' });
      if (!orgId) {
        throw new CarbonError({
          code: 'CARBON_INVALID_INPUT',
          message: 'Could not resolve the target organization for this Slack install',
          expose: true,
        });
      }

      const exchange = await slackApi.exchangeCode({
        code,
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        redirectUri: cfg.redirectUri,
      });
      if (!exchange.ok || !exchange.access_token || !exchange.team?.id) {
        throw new CarbonError({
          code: 'CARBON_INVALID_INPUT',
          message: `Slack OAuth exchange failed: ${exchange.error ?? 'unknown_error'}`,
          expose: true,
        });
      }

      const session = (req as SessionAuthenticatedRequest).sessionUser;
      const id = makeId('slkinst');
      const encrypted = encryptSlackToken(exchange.access_token);

      // Upsert-ish: unique on (orgId, teamId). If a row exists, update it.
      const existing = await ctx.db
        .select({ id: schema.slackInstallations.id })
        .from(schema.slackInstallations)
        .where(
          and(
            eq(schema.slackInstallations.orgId, orgId),
            eq(schema.slackInstallations.teamId, exchange.team.id),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        await ctx.db
          .update(schema.slackInstallations)
          .set({
            teamName: exchange.team.name,
            accessToken: encrypted,
            botUserId: exchange.bot_user_id ?? null,
            appId: exchange.app_id ?? null,
            installedBy: session?.id ?? null,
            installedAt: new Date(),
          })
          .where(eq(schema.slackInstallations.id, existing[0]!.id));
      } else {
        await ctx.db.insert(schema.slackInstallations).values({
          id,
          orgId,
          teamId: exchange.team.id,
          teamName: exchange.team.name,
          accessToken: encrypted,
          botUserId: exchange.bot_user_id ?? null,
          appId: exchange.app_id ?? null,
          installedBy: session?.id ?? null,
        });
      }

      const actor = getActor(req);
      await recordEvent(ctx, {
        orgId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'slack_installation.created',
        metadata: { teamId: exchange.team.id, teamName: exchange.team.name },
      });

      // A browser hitting Slack's redirect expects an HTML landing, not JSON —
      // send them back to the dashboard's integrations page.
      reply.redirect(`${cfg.dashboardUrl}/settings?slack=installed`, 302);
    },
  );

  // --------------------------------------------------------------------------
  // List installations for the caller's org.
  // --------------------------------------------------------------------------
  app.get(
    '/v1/slack/installations',
    {
      preHandler: requireScope('admin'),
      schema: {
        summary: "List Slack installations for the caller's org",
        response: { 200: zodResponse(InstallationListResponse) },
      },
    },
    async (req) => {
      const orgId = resolveCallerOrg(req);
      await requireAdminForOrg(ctx, req, orgId);
      const rows = await ctx.db
        .select({
          id: schema.slackInstallations.id,
          orgId: schema.slackInstallations.orgId,
          teamId: schema.slackInstallations.teamId,
          teamName: schema.slackInstallations.teamName,
          botUserId: schema.slackInstallations.botUserId,
          appId: schema.slackInstallations.appId,
          installedBy: schema.slackInstallations.installedBy,
          installedAt: schema.slackInstallations.installedAt,
        })
        .from(schema.slackInstallations)
        .where(eq(schema.slackInstallations.orgId, orgId));
      return {
        data: rows.map((r) => ({
          ...r,
          installedAt:
            r.installedAt instanceof Date ? r.installedAt.toISOString() : String(r.installedAt),
        })),
      };
    },
  );

  // --------------------------------------------------------------------------
  // List subscriptions for the caller's org (across all installations).
  // --------------------------------------------------------------------------
  app.get(
    '/v1/slack/subscriptions',
    {
      preHandler: requireScope('admin'),
      schema: {
        summary: "List Slack channel subscriptions for the caller's org",
        response: { 200: zodResponse(SubscriptionListResponse) },
      },
    },
    async (req) => {
      const orgId = resolveCallerOrg(req);
      await requireAdminForOrg(ctx, req, orgId);
      const installs = await ctx.db
        .select({ id: schema.slackInstallations.id })
        .from(schema.slackInstallations)
        .where(eq(schema.slackInstallations.orgId, orgId));
      const installIds = installs.map((i) => i.id);
      if (installIds.length === 0) return { data: [] };
      const rows = await ctx.db
        .select()
        .from(schema.slackChannelSubscriptions)
        .where(inArray(schema.slackChannelSubscriptions.installationId, installIds));
      return {
        data: rows.map((r) => ({
          id: r.id,
          installationId: r.installationId,
          channelId: r.channelId,
          channelName: r.channelName,
          events: r.events,
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        })),
      };
    },
  );

  // --------------------------------------------------------------------------
  // Create a subscription.
  // --------------------------------------------------------------------------
  app.post(
    '/v1/slack/subscriptions',
    {
      preHandler: requireScope('admin'),
      schema: {
        summary: 'Subscribe a Slack channel to org events',
        body: zodBody(SubscriptionBody),
        response: { 201: zodResponse(SubscriptionView) },
      },
    },
    async (req, reply) => {
      const body = SubscriptionBody.parse(req.body ?? {});
      const orgId = resolveCallerOrg(req);
      await requireAdminForOrg(ctx, req, orgId);

      const [install] = await ctx.db
        .select({ id: schema.slackInstallations.id, orgId: schema.slackInstallations.orgId })
        .from(schema.slackInstallations)
        .where(eq(schema.slackInstallations.id, body.installationId))
        .limit(1);
      if (!install) throw new NotFoundError('slack_installation', body.installationId);
      if (install.orgId !== orgId) {
        throw new CarbonError({
          code: 'CARBON_FORBIDDEN',
          message: 'Installation belongs to a different organization',
          expose: true,
        });
      }

      const id = makeId('slksub');
      const createdAt = new Date();
      await ctx.db.insert(schema.slackChannelSubscriptions).values({
        id,
        installationId: body.installationId,
        channelId: body.channelId,
        channelName: body.channelName,
        events: body.events,
        createdAt,
      });

      const actor = getActor(req);
      await recordEvent(ctx, {
        orgId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'slack_subscription.created',
        metadata: { channelId: body.channelId, events: body.events },
      });

      reply.status(201);
      return {
        id,
        installationId: body.installationId,
        channelId: body.channelId,
        channelName: body.channelName,
        events: body.events,
        createdAt: createdAt.toISOString(),
      };
    },
  );

  // --------------------------------------------------------------------------
  // Delete a subscription.
  // --------------------------------------------------------------------------
  app.delete<{ Params: { id: string } }>(
    '/v1/slack/subscriptions/:id',
    {
      preHandler: requireScope('admin'),
      schema: { summary: 'Remove a Slack channel subscription' },
    },
    async (req, reply) => {
      const orgId = resolveCallerOrg(req);
      await requireAdminForOrg(ctx, req, orgId);

      // Join through installation to enforce that the sub belongs to the caller's org.
      const [row] = await ctx.db
        .select({
          id: schema.slackChannelSubscriptions.id,
          orgId: schema.slackInstallations.orgId,
        })
        .from(schema.slackChannelSubscriptions)
        .innerJoin(
          schema.slackInstallations,
          eq(schema.slackInstallations.id, schema.slackChannelSubscriptions.installationId),
        )
        .where(eq(schema.slackChannelSubscriptions.id, req.params.id))
        .limit(1);
      if (!row) throw new NotFoundError('slack_subscription', req.params.id);
      if (row.orgId !== orgId) {
        throw new CarbonError({
          code: 'CARBON_FORBIDDEN',
          message: 'Subscription belongs to a different organization',
          expose: true,
        });
      }
      await ctx.db
        .delete(schema.slackChannelSubscriptions)
        .where(eq(schema.slackChannelSubscriptions.id, req.params.id));
      const actor = getActor(req);
      await recordEvent(ctx, {
        orgId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'slack_subscription.deleted',
        metadata: { id: req.params.id },
      });
      reply.status(204).send();
    },
  );

  // --------------------------------------------------------------------------
  // Delete an installation — best-effort revoke on Slack, then hard-delete.
  // --------------------------------------------------------------------------
  app.delete<{ Params: { id: string } }>(
    '/v1/slack/installations/:id',
    {
      preHandler: requireScope('admin'),
      schema: { summary: 'Uninstall a Slack workspace integration' },
    },
    async (req, reply) => {
      const orgId = resolveCallerOrg(req);
      await requireAdminForOrg(ctx, req, orgId);

      const [row] = await ctx.db
        .select()
        .from(schema.slackInstallations)
        .where(eq(schema.slackInstallations.id, req.params.id))
        .limit(1);
      if (!row) throw new NotFoundError('slack_installation', req.params.id);
      if (row.orgId !== orgId) {
        throw new CarbonError({
          code: 'CARBON_FORBIDDEN',
          message: 'Installation belongs to a different organization',
          expose: true,
        });
      }

      try {
        const token = decryptSlackToken(row.accessToken);
        await slackApi.revoke({ token });
      } catch (err) {
        // Slack revoke is best-effort — if it fails we still want to delete the
        // local row so a broken install can be cleaned up.
        ctx.logger.warn('slack.revoke_failed', {
          id: req.params.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }

      await ctx.db
        .delete(schema.slackInstallations)
        .where(eq(schema.slackInstallations.id, req.params.id));

      const actor = getActor(req);
      await recordEvent(ctx, {
        orgId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'slack_installation.deleted',
        metadata: { id: req.params.id, teamId: row.teamId },
      });
      reply.status(204).send();
    },
  );
}
