import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CarbonError, NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import type { SessionAuthenticatedRequest } from '../plugins/session-auth.js';
import { requireScope } from '../plugins/scopes.js';
import { zodBody, zodResponse, zodResponseWithExample } from '../plugins/schema-helpers.js';

const OrgSummary = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  role: z.enum(['owner', 'admin', 'member']).optional(),
});
const OrgListResponse = z.object({ data: z.array(OrgSummary) });
const OrgFull = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  retentionDays: z.number().int().nullable().optional(),
  settings: z.record(z.unknown()).nullable().optional(),
  createdAt: z.string().datetime().optional(),
});
const OrgMember = z.object({
  userId: z.string(),
  role: z.enum(['owner', 'admin', 'member']),
  createdAt: z.string().datetime().optional(),
  email: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
});
const OrgMemberListResponse = z.object({ data: z.array(OrgMember) });
const InvitationResponse = z.object({
  id: z.string(),
  orgId: z.string(),
  email: z.string(),
  role: z.enum(['owner', 'admin', 'member']),
  expiresAt: z.string().datetime(),
  inviteUrl: z.string(),
});
const AcceptResponse = z.object({
  orgId: z.string(),
  role: z.enum(['owner', 'admin', 'member']),
  accepted: z.boolean(),
});

/**
 * Organization management — the surface where owners/admins configure the
 * org, invite teammates, and manage roles.
 *
 * Permissions collapse two auth paths into a single role:
 *   - Firebase (browser) callers → look up their `memberships` row for the org.
 *   - API-key (machine) callers → an `admin`-scoped key on the same org is
 *     treated as `owner`; other scopes on the same org get `member`. Keys for
 *     a different org get 403.
 *
 * "Last owner" is protected on both PATCH-role and DELETE-member so an org
 * can never be locked out.
 */

type Role = 'owner' | 'admin' | 'member';

const RoleEnum = z.enum(['owner', 'admin', 'member']);

const PatchOrgBody = z.object({
  name: z.string().min(1).max(200).optional(),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase letters, numbers, and dashes')
    .optional(),
  retentionDays: z.number().int().min(1).max(3650).nullable().optional(),
  /**
   * Free-form org settings blob — currently stores integration webhooks and
   * SSO providers. Kept permissive so new fields can land without a coordinated
   * dashboard release; merged shallow-over-existing on write.
   */
  settings: z.record(z.unknown()).optional(),
});

const InviteBody = z.object({
  email: z.string().email().max(320),
  role: RoleEnum.default('member'),
});

const PatchMemberBody = z.object({ role: RoleEnum });

const AcceptBody = z.object({ token: z.string().min(8).max(200) });

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

interface CallerContext {
  readonly role: Role;
  readonly userId: string | null;
  readonly isApiKey: boolean;
}

/**
 * Resolve the caller's effective role for `orgId`, or throw 403. Returns
 * `null` only when auth is disabled entirely (dev mode with no apiKey and no
 * firebaseUser) — those callers are treated as the org owner so local dev
 * mirrors the existing project-access behavior.
 */
async function callerContext(
  ctx: AppContext,
  req: FastifyRequest,
  orgId: string,
): Promise<CallerContext> {
  const apiKey = (req as AuthenticatedRequest).apiKey;
  const sessionUser = (req as SessionAuthenticatedRequest).sessionUser;

  if (apiKey) {
    if (apiKey.orgId !== orgId) {
      throw new CarbonError({
        code: 'CARBON_FORBIDDEN',
        message: 'API key not scoped to this organization',
        expose: true,
      });
    }
    // Admin scope on the matching org == owner. Any lesser scope is member —
    // the route-level requireScope() guards will already have rejected the
    // ones that don't even hold `read`.
    const role: Role = apiKey.scopes.includes('admin') ? 'owner' : 'member';
    return { role, userId: null, isApiKey: true };
  }

  if (sessionUser) {
    const [row] = await ctx.db
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .where(
        and(eq(schema.memberships.userId, sessionUser.id), eq(schema.memberships.orgId, orgId)),
      )
      .limit(1);
    if (!row) {
      throw new CarbonError({
        code: 'CARBON_FORBIDDEN',
        message: 'Not a member of this organization',
        expose: true,
      });
    }
    return { role: row.role as Role, userId: sessionUser.id, isApiKey: false };
  }

  // Auth disabled (CARBON_AUTH_MODE=disabled and no Firebase) — treat as
  // owner to keep local dev unblocked, same posture as project-access.ts.
  return { role: 'owner', userId: null, isApiKey: false };
}

function requireAdminOrOwner(caller: CallerContext): void {
  if (caller.role === 'owner' || caller.role === 'admin') return;
  throw new CarbonError({
    code: 'CARBON_FORBIDDEN',
    message: 'Owner or admin role required',
    details: { held: caller.role },
    expose: true,
  });
}

async function countOtherOwners(
  ctx: AppContext,
  orgId: string,
  exceptUserId: string,
): Promise<number> {
  const rows = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.orgId, orgId),
        eq(schema.memberships.role, 'owner'),
        ne(schema.memberships.userId, exceptUserId),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

async function loadOrgOr404(ctx: AppContext, id: string) {
  const [org] = await ctx.db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, id))
    .limit(1);
  if (!org) throw new NotFoundError('organization', id);
  return org;
}

export async function registerOrganizationRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  // List the caller's memberships. API-key callers see the single org their
  // key is scoped to; session users see every org they belong to; auth-
  // disabled dev callers see every org in the store (optionally narrowed by
  // ?userId=). Registered before /:id so the radix router keeps them distinct.
  app.get(
    '/v1/organizations',
    {
      preHandler: requireScope('read'),
      schema: {
        summary: 'List organizations for the caller',
        description:
          'Return every org the caller can see. API-key callers see the single org their key is scoped to; ' +
          'session users see every org they belong to.',
        response: { 200: zodResponse(OrgListResponse) },
      },
    },
    async (req) => {
      const query = z.object({ userId: z.string().min(1).optional() }).parse(req.query);
      const apiKey = (req as AuthenticatedRequest).apiKey;
      const session = (req as SessionAuthenticatedRequest).sessionUser;
      if (apiKey) {
        const [row] = await ctx.db
          .select({
            id: schema.organizations.id,
            name: schema.organizations.name,
            slug: schema.organizations.slug,
          })
          .from(schema.organizations)
          .where(eq(schema.organizations.id, apiKey.orgId))
          .limit(1);
        return { data: row ? [row] : [] };
      }
      if (session?.id) {
        const rows = await ctx.db
          .select({
            id: schema.organizations.id,
            name: schema.organizations.name,
            slug: schema.organizations.slug,
            role: schema.memberships.role,
          })
          .from(schema.memberships)
          .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
          .where(eq(schema.memberships.userId, session.id));
        return { data: rows };
      }
      // Auth-disabled dev: return every org (optionally scoped by ?userId=).
      if (query.userId) {
        const rows = await ctx.db
          .select({
            id: schema.organizations.id,
            name: schema.organizations.name,
            slug: schema.organizations.slug,
            role: schema.memberships.role,
          })
          .from(schema.memberships)
          .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
          .where(eq(schema.memberships.userId, query.userId));
        return { data: rows };
      }
      const rows = await ctx.db
        .select({
          id: schema.organizations.id,
          name: schema.organizations.name,
          slug: schema.organizations.slug,
        })
        .from(schema.organizations);
      return { data: rows };
    },
  );

  // Resolves the caller's "current" org — the api key's org, the session
  // user's first membership, or (auth-disabled dev) an ?orgId= query param.
  // Registered before /:id so Fastify's radix router routes /current here.
  app.get(
    '/v1/organizations/current',
    {
      preHandler: requireScope('read'),
      schema: {
        summary: "Get the caller's current organization",
        description:
          "Resolve the caller's \"current\" org — the API key's org, the session user's first membership, or an `orgId` query param when auth is disabled.",
        response: {
          200: zodResponseWithExample(OrgFull, {
            id: 'org_01HXK5H7Q9C0R3Q1S8V6M4WJZK',
            name: 'Acme Corp',
            slug: 'acme-corp',
            retentionDays: 90,
            settings: { slackWebhook: 'https://hooks.slack.com/services/T000/B000/xxx' },
            createdAt: '2025-09-01T12:00:00.000Z',
          }),
          404: zodResponse(
            z.object({ error: z.object({ code: z.string(), message: z.string() }) }),
          ),
        },
      },
    },
    async (req, reply) => {
      const query = z.object({ orgId: z.string().min(1).optional() }).parse(req.query);
      const apiKey = (req as AuthenticatedRequest).apiKey;
      const session = (req as SessionAuthenticatedRequest).sessionUser;
      const orgId = apiKey?.orgId ?? session?.orgId ?? query.orgId;
      if (!orgId) {
        reply.status(404);
        return {
          error: { code: 'CARBON_NOT_FOUND', message: 'No current organization for this caller' },
        };
      }
      return loadOrgOr404(ctx, orgId);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/v1/organizations/:id',
    {
      preHandler: requireScope('read'),
      schema: {
        summary: 'Get an organization by id',
        description:
          'Fetch a single organization. The caller must be a member (or hold an API key scoped to it).',
        response: { 200: zodResponse(OrgFull) },
      },
    },
    async (req) => {
      await callerContext(ctx, req, req.params.id);
      return loadOrgOr404(ctx, req.params.id);
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/v1/organizations/:id',
    {
      preHandler: requireScope('admin'),
      schema: {
        summary: 'Update an organization',
        description:
          'Owner/admin only. Fields not present in the body are left untouched; `settings` is shallow-merged over the current value.',
        body: zodBody(PatchOrgBody),
        response: { 200: zodResponse(OrgFull) },
      },
    },
    async (req) => {
      const body = PatchOrgBody.parse(req.body ?? {});
      const caller = await callerContext(ctx, req, req.params.id);
      requireAdminOrOwner(caller);
      // Existence check first so we return 404 not 400 when the org is gone.
      await loadOrgOr404(ctx, req.params.id);

      const patch: Partial<{
        name: string;
        slug: string;
        retentionDays: number | null;
        settings: Record<string, unknown>;
      }> = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.slug !== undefined) patch.slug = body.slug;
      if (body.retentionDays !== undefined) patch.retentionDays = body.retentionDays;
      if (body.settings !== undefined) {
        // Shallow-merge so a partial write (e.g. just the Slack webhook) does
        // not clobber unrelated keys like `ssoProviders`.
        const existing = await loadOrgOr404(ctx, req.params.id);
        const current = (existing.settings ?? {}) as Record<string, unknown>;
        patch.settings = { ...current, ...body.settings };
      }
      if (Object.keys(patch).length === 0) return loadOrgOr404(ctx, req.params.id);

      const [updated] = await ctx.db
        .update(schema.organizations)
        .set(patch)
        .where(eq(schema.organizations.id, req.params.id))
        .returning();
      return updated;
    },
  );

  app.get<{ Params: { id: string } }>(
    '/v1/organizations/:id/members',
    {
      preHandler: requireScope('read'),
      schema: {
        summary: 'List organization members',
        description:
          'Return every user with a membership row on this org, joined with the users table for display name/email.',
        response: {
          200: zodResponseWithExample(OrgMemberListResponse, {
            data: [
              {
                userId: 'usr_01HXK5H7Q9C0R3Q1S8V6M4WJZK',
                role: 'owner',
                createdAt: '2025-09-01T12:00:00.000Z',
                email: 'alex@acme.example',
                name: 'Alex Kim',
              },
              {
                userId: 'usr_01HXK6P8T3H5C9D4F7G0J2K1L4',
                role: 'member',
                createdAt: '2025-10-11T09:14:22.000Z',
                email: 'jordan@acme.example',
                name: 'Jordan Rivera',
              },
            ],
          }),
        },
      },
    },
    async (req) => {
      await callerContext(ctx, req, req.params.id);
      const rows = await ctx.db
        .select({
          userId: schema.memberships.userId,
          role: schema.memberships.role,
          createdAt: schema.memberships.createdAt,
          email: schema.users.email,
          name: schema.users.name,
        })
        .from(schema.memberships)
        .leftJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(eq(schema.memberships.orgId, req.params.id));
      return { data: rows };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/organizations/:id/members',
    {
      preHandler: requireScope('admin'),
      schema: {
        summary: 'Invite a user to the organization',
        description:
          'Owner/admin only. Creates an invitation with a signed accept URL that the invitee opens to join.',
        body: zodBody(InviteBody),
        response: { 201: zodResponse(InvitationResponse) },
      },
    },
    async (req, reply) => {
      const body = InviteBody.parse(req.body ?? {});
      const caller = await callerContext(ctx, req, req.params.id);
      requireAdminOrOwner(caller);
      await loadOrgOr404(ctx, req.params.id);

      const token = randomUUID().replace(/-/g, '');
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
      const inviteId = randomUUID();
      await ctx.db.insert(schema.invitations).values({
        id: inviteId,
        orgId: req.params.id,
        email: body.email.toLowerCase(),
        role: body.role,
        token,
        invitedBy: caller.userId,
        expiresAt,
      });

      const base = process.env.DASHBOARD_URL ?? 'http://localhost:3001';
      const inviteUrl = `${base.replace(/\/$/, '')}/invitations/accept?token=${token}`;
      reply.status(201);
      return {
        id: inviteId,
        orgId: req.params.id,
        email: body.email.toLowerCase(),
        role: body.role,
        expiresAt,
        inviteUrl,
      };
    },
  );

  app.patch<{ Params: { id: string; userId: string } }>(
    '/v1/organizations/:id/members/:userId',
    {
      preHandler: requireScope('admin'),
      schema: {
        summary: "Change a member's role",
        description:
          'Owner/admin only. Demoting the last remaining owner is rejected with 409 so the org cannot be stranded without an admin path back in.',
        body: zodBody(PatchMemberBody),
        response: {
          200: zodResponse(z.object({ userId: z.string(), role: RoleEnum })),
        },
      },
    },
    async (req) => {
      const body = PatchMemberBody.parse(req.body ?? {});
      const caller = await callerContext(ctx, req, req.params.id);
      requireAdminOrOwner(caller);

      const [target] = await ctx.db
        .select({ role: schema.memberships.role })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.orgId, req.params.id),
            eq(schema.memberships.userId, req.params.userId),
          ),
        )
        .limit(1);
      if (!target) throw new NotFoundError('membership', req.params.userId);

      // Demoting the last remaining owner would strand the org with no admin
      // path back in. Reject before writing.
      if (target.role === 'owner' && body.role !== 'owner') {
        const others = await countOtherOwners(ctx, req.params.id, req.params.userId);
        if (others === 0) {
          throw new CarbonError({
            code: 'CARBON_CONFLICT',
            message: 'Cannot demote the last owner of the organization',
            expose: true,
          });
        }
      }

      const [updated] = await ctx.db
        .update(schema.memberships)
        .set({ role: body.role })
        .where(
          and(
            eq(schema.memberships.orgId, req.params.id),
            eq(schema.memberships.userId, req.params.userId),
          ),
        )
        .returning({
          userId: schema.memberships.userId,
          role: schema.memberships.role,
        });
      return updated;
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    '/v1/organizations/:id/members/:userId',
    {
      preHandler: requireScope('admin'),
      schema: {
        summary: 'Remove an organization member',
        description: 'Owner/admin only. Removing the last remaining owner is rejected with 409.',
      },
    },
    async (req, reply) => {
      const caller = await callerContext(ctx, req, req.params.id);
      requireAdminOrOwner(caller);

      const [target] = await ctx.db
        .select({ role: schema.memberships.role })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.orgId, req.params.id),
            eq(schema.memberships.userId, req.params.userId),
          ),
        )
        .limit(1);
      if (!target) throw new NotFoundError('membership', req.params.userId);

      if (target.role === 'owner') {
        const others = await countOtherOwners(ctx, req.params.id, req.params.userId);
        if (others === 0) {
          throw new CarbonError({
            code: 'CARBON_CONFLICT',
            message: 'Cannot remove the last owner of the organization',
            expose: true,
          });
        }
      }

      await ctx.db
        .delete(schema.memberships)
        .where(
          and(
            eq(schema.memberships.orgId, req.params.id),
            eq(schema.memberships.userId, req.params.userId),
          ),
        );
      reply.status(204);
    },
  );

  // Invitation acceptance is public in the "no org scope" sense: any
  // authenticated user (Firebase) can accept an invite addressed to them.
  // API-key callers have no user identity, so they can't accept.
  app.post(
    '/v1/invitations/accept',
    {
      schema: {
        summary: 'Accept an organization invitation',
        description:
          'Consume an invitation token and create the corresponding membership. Requires a signed-in session user.',
        body: zodBody(AcceptBody),
        response: { 200: zodResponse(AcceptResponse) },
      },
    },
    async (req) => {
      const body = AcceptBody.parse(req.body ?? {});
      const sessionUser = (req as SessionAuthenticatedRequest).sessionUser;
      if (!sessionUser) {
        throw new CarbonError({
          code: 'CARBON_UNAUTHENTICATED',
          message: 'Sign in to accept an invitation',
          expose: true,
        });
      }

      const [invite] = await ctx.db
        .select()
        .from(schema.invitations)
        .where(eq(schema.invitations.token, body.token))
        .limit(1);
      if (!invite) throw new NotFoundError('invitation', body.token);
      if (invite.acceptedAt) {
        throw new CarbonError({
          code: 'CARBON_CONFLICT',
          message: 'Invitation already accepted',
          expose: true,
        });
      }
      if (invite.expiresAt.getTime() <= Date.now()) {
        throw new CarbonError({
          code: 'CARBON_CONFLICT',
          message: 'Invitation expired',
          details: { expiredAt: invite.expiresAt.toISOString() },
          expose: true,
        });
      }
      if (normalizeEmail(sessionUser.email) !== normalizeEmail(invite.email)) {
        throw new CarbonError({
          code: 'CARBON_FORBIDDEN',
          message: 'Invitation is addressed to a different email',
          expose: true,
        });
      }

      // Idempotent: if a membership already exists (e.g. the user was added
      // out-of-band), skip the insert. Either way, mark the invite consumed.
      const [existing] = await ctx.db
        .select({ id: schema.memberships.id })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.userId, sessionUser.id),
            eq(schema.memberships.orgId, invite.orgId),
          ),
        )
        .limit(1);
      if (!existing) {
        await ctx.db.insert(schema.memberships).values({
          id: randomUUID(),
          userId: sessionUser.id,
          orgId: invite.orgId,
          role: invite.role,
        });
      }

      await ctx.db
        .update(schema.invitations)
        .set({ acceptedAt: new Date() })
        .where(eq(schema.invitations.id, invite.id));

      return {
        orgId: invite.orgId,
        role: invite.role,
        accepted: true,
      };
    },
  );
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
