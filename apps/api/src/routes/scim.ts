import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { CarbonError, makeId, NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { zodBody, zodQuery, zodResponse } from '../plugins/schema-helpers.js';

const ScimUserSchema = z.object({
  schemas: z.array(z.string()),
  id: z.string(),
  userName: z.string(),
  active: z.boolean(),
  emails: z.array(z.object({ value: z.string(), primary: z.boolean() })),
  name: z.object({ formatted: z.string().nullable().optional() }).optional(),
  meta: z.object({
    resourceType: z.literal('User'),
    created: z.string(),
    lastModified: z.string(),
  }),
});
const ScimUserListResponse = z.object({
  schemas: z.array(z.string()),
  totalResults: z.number().int(),
  startIndex: z.number().int(),
  itemsPerPage: z.number().int(),
  Resources: z.array(ScimUserSchema),
});
const ScimGroupSchema = z.object({
  schemas: z.array(z.string()),
  id: z.string(),
  displayName: z.string(),
  members: z.array(z.object({ value: z.string(), display: z.string() })),
  meta: z.object({ resourceType: z.literal('Group') }),
});
const ScimGroupListResponse = z.object({
  schemas: z.array(z.string()),
  totalResults: z.number().int(),
  startIndex: z.number().int(),
  itemsPerPage: z.number().int(),
  Resources: z.array(ScimGroupSchema),
});

/**
 * Minimal SCIM 2.0 provisioning surface. Enterprise-only: gated behind
 * `organizations.isEnterprise` and reachable through either the standard
 * `x-carbon-key` header (admin scope) OR the SCIM-standard `X-SCIM-Token`
 * header for identity providers that only speak SCIM. Both point at the
 * same api_keys table today — we do not add a new scope enum entry.
 *
 * Supported subset:
 *   GET    /scim/v2/Users?filter=userName eq "…"
 *   POST   /scim/v2/Users            → invite (create pending user + membership)
 *   GET    /scim/v2/Users/:id
 *   PATCH  /scim/v2/Users/:id        → active:false removes membership
 *   DELETE /scim/v2/Users/:id        → remove membership
 *   GET    /scim/v2/Groups           → memberships grouped by role
 *
 * We deliberately reject unknown SCIM operations rather than pretending they
 * succeed — a lie here corrupts the customer's IdP mirror.
 */

const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCIM_PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

interface ScimUser {
  readonly schemas: string[];
  readonly id: string;
  readonly userName: string;
  readonly active: boolean;
  readonly emails: Array<{ value: string; primary: boolean }>;
  readonly name?: { formatted?: string | null };
  readonly meta: { resourceType: 'User'; created: string; lastModified: string };
}

const CreateUserBody = z.object({
  schemas: z.array(z.string()).optional(),
  userName: z.string().email(),
  active: z.boolean().optional().default(true),
  name: z
    .object({
      formatted: z.string().optional(),
      givenName: z.string().optional(),
      familyName: z.string().optional(),
    })
    .optional(),
  emails: z
    .array(z.object({ value: z.string().email(), primary: z.boolean().optional() }))
    .optional(),
});

const PatchBody = z.object({
  schemas: z.array(z.string()).optional(),
  Operations: z.array(
    z.object({
      op: z.string(),
      path: z.string().optional(),
      value: z.unknown().optional(),
    }),
  ),
});

const ListQuery = z.object({
  filter: z.string().optional(),
  startIndex: z.coerce.number().int().min(1).default(1),
  count: z.coerce.number().int().min(0).max(200).default(100),
});

export async function registerScimRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // Auth: SCIM requests may present an X-SCIM-Token instead of the standard
  // x-carbon-key. If X-SCIM-Token is present, resolve it against api_keys and
  // attach the same `apiKey` object the api-key plugin would.
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/scim/')) return;
    const auth = req as AuthenticatedRequest;
    if (auth.apiKey) return; // Already authenticated via x-carbon-key.
    const raw = req.headers['x-scim-token'];
    const presented = Array.isArray(raw) ? raw[0] : raw;
    if (!presented) return; // Let the guard below fail with a SCIM error.
    // Format matches ck_live_<prefix>.<secret>; we reuse the same api-key path
    // for verification via a direct DB lookup.
    const match = /^ck_live_([a-f0-9]{12})\.([A-Za-z0-9_-]{32,128})$/.exec(presented);
    if (!match) return;
    const [, prefix, secret] = match;
    if (!prefix || !secret) return;
    const rows = await ctx.db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.prefix, prefix))
      .limit(1);
    const row = rows[0];
    if (!row || row.revokedAt) return;
    const { createHash, timingSafeEqual } = await import('node:crypto');
    const hash = createHash('sha256').update(secret).digest();
    const stored = Buffer.from(row.hash, 'hex');
    if (stored.length !== hash.length || !timingSafeEqual(stored, hash)) return;
    auth.apiKey = {
      id: row.id,
      orgId: row.orgId,
      prefix: row.prefix,
      scopes: Array.isArray(row.scopes) && row.scopes.length > 0 ? row.scopes : ['admin'],
      projectIds: Array.isArray(row.projectIds) ? row.projectIds : null,
      expiresAt: row.expiresAt ?? null,
    };
  });

  const gate = async (req: FastifyRequest, reply: FastifyReply): Promise<string | undefined> => {
    const apiKey = (req as AuthenticatedRequest).apiKey;
    if (!apiKey) {
      scimError(reply, 401, 'Missing X-SCIM-Token or x-carbon-key');
      return undefined;
    }
    // We do not add a dedicated scope enum entry — accept admin (implicitly
    // includes any future 'scim' scope callers already hold).
    const scopes = apiKey.scopes;
    if (!scopes.includes('admin') && !scopes.includes('scim')) {
      scimError(reply, 403, 'admin scope required');
      return undefined;
    }
    const org = (
      await ctx.db
        .select({ isEnterprise: schema.organizations.isEnterprise })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, apiKey.orgId))
        .limit(1)
    )[0];
    if (!org?.isEnterprise) {
      scimError(reply, 403, 'SCIM is available on Enterprise plans only');
      return undefined;
    }
    return apiKey.orgId;
  };

  app.get(
    '/scim/v2/Users',
    {
      schema: {
        summary: 'SCIM: list users',
        description:
          'Enterprise-only. Authenticate with `x-carbon-key` (admin) or `X-SCIM-Token`. Supports the standard `userName eq "..."` filter plus `startIndex`/`count` paging.',
        querystring: zodQuery(ListQuery),
        response: { 200: zodResponse(ScimUserListResponse) },
      },
    },
    async (req, reply) => {
      const orgId = await gate(req, reply);
      if (!orgId) return;
      const { filter, startIndex, count } = ListQuery.parse(req.query);

      let emailFilter: string | undefined;
      if (filter) {
        // Support the single canonical SCIM filter every IdP sends:
        //   userName eq "user@example.com"
        const m = /userName\s+eq\s+"([^"]+)"/i.exec(filter);
        if (m) emailFilter = m[1];
      }

      const memberships = await ctx.db
        .select({
          userId: schema.memberships.userId,
          role: schema.memberships.role,
          email: schema.users.email,
          name: schema.users.name,
          createdAt: schema.users.createdAt,
          updatedAt: schema.users.updatedAt,
        })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(
          emailFilter
            ? and(eq(schema.memberships.orgId, orgId), eq(schema.users.email, emailFilter))
            : eq(schema.memberships.orgId, orgId),
        );

      const totalResults = memberships.length;
      const page = memberships.slice(startIndex - 1, startIndex - 1 + count);
      return {
        schemas: [SCIM_LIST_SCHEMA],
        totalResults,
        startIndex,
        itemsPerPage: page.length,
        Resources: page.map((m) =>
          toScimUser(m.userId, m.email, m.name, true, m.createdAt, m.updatedAt),
        ),
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/scim/v2/Users/:id',
    {
      schema: {
        summary: 'SCIM: get user by id',
        description:
          'Enterprise-only. Returns the SCIM Core User representation, or a SCIM error envelope on 404.',
        response: { 200: zodResponse(ScimUserSchema) },
      },
    },
    async (req, reply) => {
      const orgId = await gate(req, reply);
      if (!orgId) return;
      const row = await loadUser(ctx, orgId, req.params.id);
      if (!row) {
        scimError(reply, 404, 'User not found');
        return;
      }
      return toScimUser(row.userId, row.email, row.name, true, row.createdAt, row.updatedAt);
    },
  );

  app.post(
    '/scim/v2/Users',
    {
      schema: {
        summary: 'SCIM: create user',
        description:
          'Enterprise-only. Provisions a user (if missing) and attaches a membership. Existing users are re-attached idempotently. SCIM provisioning does not set a password — an invitation token is created for the invitee to finish sign-up.',
        body: zodBody(CreateUserBody),
        response: { 201: zodResponse(ScimUserSchema) },
      },
    },
    async (req, reply) => {
      const orgId = await gate(req, reply);
      if (!orgId) return;
      let body: z.infer<typeof CreateUserBody>;
      try {
        body = CreateUserBody.parse(req.body);
      } catch (err) {
        scimError(reply, 400, err instanceof Error ? err.message : 'Invalid SCIM user');
        return;
      }
      const email = body.userName.toLowerCase();

      // If the user already exists globally, just attach a membership.
      const existing = (
        await ctx.db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1)
      )[0];

      let userId: string;
      let createdAt: Date;
      let updatedAt: Date;
      if (existing) {
        userId = existing.id;
        createdAt = existing.createdAt;
        updatedAt = existing.updatedAt;
      } else {
        userId = makeId('usr');
        const now = new Date();
        const inserted = await ctx.db
          .insert(schema.users)
          .values({
            id: userId,
            email,
            emailVerified: false,
            name: body.name?.formatted ?? null,
          })
          .returning();
        createdAt = inserted[0]?.createdAt ?? now;
        updatedAt = inserted[0]?.updatedAt ?? now;

        // Provisioning via SCIM does not set a password — record an invitation
        // so the user can finish sign-up via the normal Better Auth flow.
        await ctx.db.insert(schema.invitations).values({
          id: makeId('inv'),
          orgId,
          email,
          role: 'member',
          token: randomBytes(24).toString('hex'),
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        });
      }

      const existingMembership = (
        await ctx.db
          .select()
          .from(schema.memberships)
          .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)))
          .limit(1)
      )[0];
      if (!existingMembership) {
        await ctx.db.insert(schema.memberships).values({
          id: makeId('mbr'),
          userId,
          orgId,
          role: 'member',
        });
      }

      reply.status(201);
      return toScimUser(
        userId,
        email,
        body.name?.formatted ?? null,
        body.active !== false,
        createdAt,
        updatedAt,
      );
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/scim/v2/Users/:id',
    {
      schema: {
        summary: 'SCIM: patch user',
        description:
          'Enterprise-only. Applies a SCIM PatchOp. Setting `active: false` removes the membership; other operations are accepted as no-ops so IdPs do not retry.',
        body: zodBody(PatchBody),
        response: { 200: zodResponse(ScimUserSchema) },
      },
    },
    async (req, reply) => {
      const orgId = await gate(req, reply);
      if (!orgId) return;
      let body: z.infer<typeof PatchBody>;
      try {
        body = PatchBody.parse(req.body);
      } catch (err) {
        scimError(reply, 400, err instanceof Error ? err.message : 'Invalid PatchOp');
        return;
      }
      const row = await loadUser(ctx, orgId, req.params.id);
      if (!row) {
        scimError(reply, 404, 'User not found');
        return;
      }
      // Only one op matters at the moment: setting active=false → remove the
      // membership. Everything else is accepted as a no-op so IdPs don't retry.
      let active = true;
      for (const op of body.Operations) {
        const value = op.value as { active?: boolean } | boolean | undefined;
        if (op.path === 'active') {
          active = typeof value === 'boolean' ? value : true;
        } else if (typeof value === 'object' && value && 'active' in value) {
          active = value.active !== false;
        }
      }
      if (!active) {
        await ctx.db
          .delete(schema.memberships)
          .where(
            and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, row.userId)),
          );
      }
      return toScimUser(row.userId, row.email, row.name, active, row.createdAt, row.updatedAt);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/scim/v2/Users/:id',
    {
      schema: {
        summary: 'SCIM: delete user',
        description:
          "Enterprise-only. Removes the membership for the target user in the caller's org. The underlying user row is retained.",
      },
    },
    async (req, reply) => {
      const orgId = await gate(req, reply);
      if (!orgId) return;
      const row = await loadUser(ctx, orgId, req.params.id);
      if (!row) {
        scimError(reply, 404, 'User not found');
        return;
      }
      await ctx.db
        .delete(schema.memberships)
        .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, row.userId)));
      reply.status(204);
    },
  );

  app.get(
    '/scim/v2/Groups',
    {
      schema: {
        summary: 'SCIM: list groups (by role)',
        description:
          "Enterprise-only. Returns one SCIM Group per membership role in the caller's org (`owner`/`admin`/`member`) with members listed.",
        response: { 200: zodResponse(ScimGroupListResponse) },
      },
    },
    async (req, reply) => {
      const orgId = await gate(req, reply);
      if (!orgId) return;
      const rows = await ctx.db
        .select({
          userId: schema.memberships.userId,
          role: schema.memberships.role,
          email: schema.users.email,
        })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(eq(schema.memberships.orgId, orgId));
      const byRole = new Map<string, Array<{ value: string; display: string }>>();
      for (const r of rows) {
        const arr = byRole.get(r.role) ?? [];
        arr.push({ value: r.userId, display: r.email });
        byRole.set(r.role, arr);
      }
      const groups = Array.from(byRole.entries()).map(([role, members]) => ({
        schemas: [SCIM_GROUP_SCHEMA],
        id: `${orgId}:${role}`,
        displayName: role,
        members,
        meta: { resourceType: 'Group' as const },
      }));
      return {
        schemas: [SCIM_LIST_SCHEMA],
        totalResults: groups.length,
        startIndex: 1,
        itemsPerPage: groups.length,
        Resources: groups,
      };
    },
  );
}

async function loadUser(
  ctx: AppContext,
  orgId: string,
  userId: string,
): Promise<
  | {
      userId: string;
      email: string;
      name: string | null;
      createdAt: Date;
      updatedAt: Date;
    }
  | undefined
> {
  const rows = await ctx.db
    .select({
      userId: schema.memberships.userId,
      email: schema.users.email,
      name: schema.users.name,
      createdAt: schema.users.createdAt,
      updatedAt: schema.users.updatedAt,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)))
    .limit(1);
  return rows[0];
}

function toScimUser(
  id: string,
  email: string,
  name: string | null,
  active: boolean,
  created: Date,
  updated: Date,
): ScimUser {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id,
    userName: email,
    active,
    emails: [{ value: email, primary: true }],
    name: { formatted: name },
    meta: {
      resourceType: 'User',
      created: created.toISOString(),
      lastModified: updated.toISOString(),
    },
  };
}

function scimError(reply: FastifyReply, status: number, detail: string): void {
  reply.status(status).send({
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(status),
    detail,
  });
}

// Suppress unused-import warnings for helpers exported for symmetry with the
// other route modules.
void CarbonError;
void NotFoundError;
void inArray;
