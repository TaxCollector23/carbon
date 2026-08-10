import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { CarbonError, makeId, NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { SessionAuthenticatedRequest } from '../plugins/session-auth.js';
import { recordShareLinkCreated, recordShareLinkHit } from '../plugins/metrics.js';
import { requireScope } from '../plugins/scopes.js';
import { zodBody, zodResponse } from '../plugins/schema-helpers.js';
import { getActor, recordEvent } from '../services/events.js';

const ShareLinkResponse = z.object({
  id: z.string(),
  token: z.string(),
  expiresAt: z.any(),
  url: z.string(),
});
const ShareLinkStateResponse = z.object({
  projectId: z.string(),
  expiresAt: z.any(),
  state: z.any(),
});

/**
 * Short-lived, read-only shareable replica links.
 *
 * The token is a 32-char base64url random string (~192 bits of entropy). We
 * only ever store it verbatim in the row: unlike API keys, share tokens are
 * meant to be pasted into a URL bar and re-fetched later, so hashing would
 * break the flow — but the row is deleted or `revokedAt`-set immediately on
 * DELETE, so a leaked link is bounded.
 */
const TOKEN_BYTES = 24; // 24 bytes → 32 base64url chars

export interface ShareLinkDeps {
  readonly requireProjectInOrg: (
    ctx: AppContext,
    req: FastifyRequest,
    projectId: string,
  ) => Promise<{ id: string; orgId: string; slug: string }>;
}

export async function registerShareLinkRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  deps: ShareLinkDeps,
): Promise<void> {
  const CreateBody = z.object({
    ttlHours: z.coerce.number().int().min(1).max(24 * 30).default(24),
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/v1/projects/:id/share-links',
    {
      preHandler: requireScope('write'),
      schema: {
        summary: 'Create a share link for a project',
        description: 'Mint a short-lived shareable read-only link for a project. Default TTL is 24h; cap 30 days.',
        body: zodBody(CreateBody),
      },
    },
    async (req, reply) => {
      const project = await deps.requireProjectInOrg(ctx, req, req.params.id);
      const body = CreateBody.parse(req.body ?? {});
      const id = makeId('shl');
      const token = randomBytes(TOKEN_BYTES).toString('base64url');
      const expiresAt = new Date(Date.now() + body.ttlHours * 60 * 60 * 1000);
      const createdBy = (req as SessionAuthenticatedRequest).sessionUser?.id ?? null;
      const [row] = await ctx.db
        .insert(schema.shareLinks)
        .values({ id, projectId: project.id, token, createdBy, expiresAt })
        .returning();
      const actor = getActor(req);
      await recordEvent(ctx, {
        orgId: project.orgId,
        projectId: project.id,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'share_link.created',
        metadata: { id, ttlHours: body.ttlHours },
      });
      recordShareLinkCreated();
      const dashboardUrl = process.env.DASHBOARD_URL ?? 'http://localhost:3000';
      reply.status(201);
      return {
        id: row!.id,
        token: row!.token,
        expiresAt: row!.expiresAt,
        url: `${dashboardUrl.replace(/\/$/, '')}/shared/${token}`,
      };
    },
  );

  /**
   * Public state readback — deliberately UNAUTHENTICATED beyond the token
   * itself, so the recipient of a shared link can render the replica without
   * a Carbon account. We only reveal the emulator's most recent snapshot
   * metadata; the emulator itself is expected to gate its live traffic to
   * the same token via a matching short-lived proxy.
   */
  app.get<{ Params: { token: string } }>(
    '/v1/share-links/:token/state',
    {
      schema: {
        summary: 'Read a share link\'s current state',
        description: 'Public token-gated readback of a share link. Unauthenticated beyond the token itself; returns the most recent snapshot artifact metadata.',
        response: { 200: zodResponse(ShareLinkStateResponse) },
      },
    },
    async (req) => {
      const params = z.object({ token: z.string().min(16).max(64) }).parse(req.params);
      const [link] = await ctx.db
        .select()
        .from(schema.shareLinks)
        .where(
          and(
            eq(schema.shareLinks.token, params.token),
            gt(schema.shareLinks.expiresAt, new Date()),
            isNull(schema.shareLinks.revokedAt),
          ),
        )
        .limit(1);
      if (!link) throw new NotFoundError('share_link', params.token);
      recordShareLinkHit();
      // Return the most recent snapshot artifact for the project as the
      // "current state" the recipient can read. A future revision will
      // stream the live state engine here; for now a stable pointer is
      // sufficient for embed / read-only viewer use cases.
      const [latest] = await ctx.db
        .select()
        .from(schema.artifacts)
        .where(
          and(eq(schema.artifacts.projectId, link.projectId), eq(schema.artifacts.kind, 'snapshot')),
        )
        .orderBy(schema.artifacts.createdAt)
        .limit(1);
      return {
        projectId: link.projectId,
        expiresAt: link.expiresAt,
        state: latest ?? null,
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/v1/share-links/:id',
    {
      preHandler: requireScope('write'),
      schema: {
        summary: 'Revoke a share link',
        description: 'Mark a share link revoked so subsequent state reads 404. The row is retained for audit rather than deleted.',
      },
    },
    async (req, reply) => {
      const params = z.object({ id: z.string().min(1) }).parse(req.params);
      const [row] = await ctx.db
        .select({
          id: schema.shareLinks.id,
          projectId: schema.shareLinks.projectId,
          projectSlug: schema.projects.slug,
        })
        .from(schema.shareLinks)
        .innerJoin(schema.projects, eq(schema.shareLinks.projectId, schema.projects.id))
        .where(eq(schema.shareLinks.id, params.id))
        .limit(1);
      if (!row) throw new NotFoundError('share_link', params.id);
      const project = await deps.requireProjectInOrg(ctx, req, row.projectId);
      await ctx.db
        .update(schema.shareLinks)
        .set({ revokedAt: new Date() })
        .where(eq(schema.shareLinks.id, params.id));
      const actor = getActor(req);
      await recordEvent(ctx, {
        orgId: project.orgId,
        projectId: project.id,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'share_link.revoked',
        metadata: { id: params.id },
      });
      reply.status(204).send();
    },
  );

  // Silence unused-import warnings — kept for editor auto-add convenience.
  void CarbonError;
}
