import { describe, expect, it } from 'vitest';
import { NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { schema } from '@carbon/database';
import type { SessionAuthenticatedRequest } from '../plugins/session-auth.js';
import {
  filterStoredProjectRecords,
  requireProjectAccessById,
  resolveProjectAccess,
} from './project-access.js';
import { requireProjectInOrg } from './projects.js';

/**
 * `resolveProjectAccess` terminates with `.limit()`, while
 * `filterStoredProjectRecords` awaits `.where()` directly (a batched `IN`
 * query, no limit). The chain is therefore thenable as well as chainable so
 * both shapes resolve to the same fixture rows.
 */
function makeCtx(projects: Array<{ orgId: string; slug: string }>): AppContext {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => projects,
    then: (resolve: (rows: typeof projects) => unknown) => Promise.resolve(projects).then(resolve),
  };
  return {
    logger: NoopLogger,
    db: { select: () => chain } as unknown as AppContext['db'],
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

interface TableFixture {
  projects: Array<{ id: string; orgId: string; slug: string }>;
  projectMembers: Array<{ projectId: string; userId: string }>;
  projectMembersForUser: Array<{ userId: string }>;
}

/**
 * A minimal table-aware fake. Two select() sites we care about:
 *   1. `select({id,orgId,slug}).from(projects).where(...).limit(1)` — must
 *      return the project row.
 *   2. Two `.from(projectMembers)` selects — first probes for ANY row, second
 *      probes for the session user's row.
 * We route on `from(table)` and then intercept `.limit(1)` to hand back the
 * appropriate fixture. Call count discriminates the two projectMembers reads.
 */
function makeTableAwareCtx(fx: TableFixture): AppContext {
  let membersCalls = 0;
  const chain = (): any => {
    let table: unknown = null;
    const c: any = {
      from: (t: unknown) => {
        table = t;
        return c;
      },
      where: () => c,
      limit: async () => {
        if (table === schema.projects) return fx.projects;
        if (table === schema.projectMembers) {
          membersCalls += 1;
          return membersCalls === 1 ? fx.projectMembers : fx.projectMembersForUser;
        }
        return [];
      },
    };
    return c;
  };
  return {
    logger: NoopLogger,
    db: { select: () => chain() } as unknown as AppContext['db'],
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

function req(orgId: string): FastifyRequest {
  return {
    apiKey: {
      id: 'key_1',
      orgId,
      prefix: 'aa11bb22cc33',
      scopes: ['admin'],
      projectIds: null,
    },
  } as unknown as AuthenticatedRequest;
}

describe('project access helpers', () => {
  it('resolves authenticated project slugs to org-scoped storage slugs', async () => {
    const project = await resolveProjectAccess(
      makeCtx([{ orgId: 'org_1', slug: 'acme' }]),
      req('org_1'),
      'acme',
    );

    expect(project).toEqual({
      orgId: 'org_1',
      slug: 'acme',
      storageSlug: 'org_1/acme',
    });
  });

  it('filters stored project records outside the authenticated org', async () => {
    const ctx = makeCtx([{ orgId: 'org_1', slug: 'acme' }]);
    const records = await filterStoredProjectRecords(ctx, req('org_1'), [
      { id: 'emu_1', projectSlug: 'org_1/acme' },
      { id: 'emu_2', projectSlug: 'org_2/acme' },
    ]);

    expect(records).toEqual([{ id: 'emu_1', projectSlug: 'acme' }]);
  });

  it('drops records whose project no longer exists in the org', async () => {
    // The org prefix matches but the project row is gone — a stale emulator
    // pointing at a deleted project must not leak back into the listing.
    const ctx = makeCtx([]);
    const records = await filterStoredProjectRecords(ctx, req('org_1'), [
      { id: 'emu_1', projectSlug: 'org_1/deleted' },
    ]);

    expect(records).toEqual([]);
  });

  it('requireProjectAccessById returns 404 across orgs', async () => {
    const ctx = makeCtx([{ orgId: 'org_other', slug: 'acme' }]);
    await expect(requireProjectAccessById(ctx, req('org_1'), 'proj_x')).rejects.toMatchObject({
      code: 'CARBON_NOT_FOUND',
    });
  });

  it('requireProjectAccessById forbids a session user with no project_members row', async () => {
    // Fresh table-aware fake so the two select() calls (projects, then
    // project_members) return the right rows for the ACL branch under test.
    const ctx = makeTableAwareCtx({
      projects: [{ id: 'proj_1', orgId: 'org_1', slug: 'acme' }],
      // Any row present at all narrows access to just members.
      projectMembers: [{ projectId: 'proj_1', userId: 'user_owner' }],
      projectMembersForUser: [],
    });
    const sessionReq = {
      sessionUser: {
        id: 'user_outsider',
        email: 'x@example.com',
        orgId: 'org_1',
        role: 'member' as const,
      },
    } as unknown as SessionAuthenticatedRequest;
    await expect(
      requireProjectAccessById(ctx, sessionReq as never, 'proj_1'),
    ).rejects.toMatchObject({ code: 'CARBON_FORBIDDEN' });
  });

  it('requireProjectAccessById lets a session user through when their project_members row exists', async () => {
    const ctx = makeTableAwareCtx({
      projects: [{ id: 'proj_1', orgId: 'org_1', slug: 'acme' }],
      projectMembers: [{ projectId: 'proj_1', userId: 'user_a' }],
      projectMembersForUser: [{ userId: 'user_a' }],
    });
    const sessionReq = {
      sessionUser: {
        id: 'user_a',
        email: 'a@example.com',
        orgId: 'org_1',
        role: 'member' as const,
      },
    } as unknown as SessionAuthenticatedRequest;
    const access = await requireProjectAccessById(ctx, sessionReq as never, 'proj_1');
    expect(access.id).toBe('proj_1');
    expect(access.slug).toBe('acme');
  });

  // The project-scoped routes in projects.ts + share-links.ts now flow their
  // ACL through requireProjectInOrg, which delegates to
  // requireProjectAccessById. These two cases pin the behaviour so a future
  // refactor cannot silently reopen access.
  it('requireProjectInOrg (used by /v1/projects/:id/members and share-links) forbids non-members', async () => {
    const ctx = makeTableAwareCtx({
      projects: [{ id: 'proj_1', orgId: 'org_1', slug: 'acme' }],
      projectMembers: [{ projectId: 'proj_1', userId: 'user_a' }],
      projectMembersForUser: [],
    });
    const sessionReq = {
      apiKey: undefined,
      sessionUser: {
        id: 'user_outsider',
        email: 'x@example.com',
        orgId: 'org_1',
        role: 'member' as const,
      },
    } as unknown as SessionAuthenticatedRequest;
    await expect(requireProjectInOrg(ctx, sessionReq as never, 'proj_1')).rejects.toMatchObject({
      code: 'CARBON_FORBIDDEN',
    });
  });

  it('requireProjectInOrg lets a matching session user through', async () => {
    const ctx = makeTableAwareCtx({
      projects: [{ id: 'proj_1', orgId: 'org_1', slug: 'acme' }],
      projectMembers: [{ projectId: 'proj_1', userId: 'user_a' }],
      projectMembersForUser: [{ userId: 'user_a' }],
    });
    const sessionReq = {
      apiKey: undefined,
      sessionUser: {
        id: 'user_a',
        email: 'a@example.com',
        orgId: 'org_1',
        role: 'member' as const,
      },
    } as unknown as SessionAuthenticatedRequest;
    const row = await requireProjectInOrg(ctx, sessionReq as never, 'proj_1');
    expect(row).toEqual({ id: 'proj_1', orgId: 'org_1', slug: 'acme' });
  });

  it('does not query the database when nothing is in the org', async () => {
    let queried = false;
    const ctx = makeCtx([]);
    const db = ctx.db as unknown as { select: () => unknown };
    const original = db.select;
    db.select = () => {
      queried = true;
      return original();
    };

    const records = await filterStoredProjectRecords(ctx, req('org_1'), [
      { id: 'emu_2', projectSlug: 'org_2/acme' },
    ]);

    expect(records).toEqual([]);
    expect(queried).toBe(false);
  });
});
