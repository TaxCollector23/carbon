import type { FastifyRequest } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { CarbonError, NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import type { SessionAuthenticatedRequest } from '../plugins/session-auth.js';

/**
 * Which org is the caller acting as? Prefers the API-key org (machine calls
 * pin an org) and falls back to the Better Auth session user's org (browser
 * calls). Returns undefined when neither auth path has run, e.g.
 * `CARBON_AUTH_MODE=disabled` in dev or an unauthenticated request.
 */
function callerOrgId(req: FastifyRequest): string | undefined {
  const apiKey = (req as AuthenticatedRequest).apiKey;
  if (apiKey?.orgId) return apiKey.orgId;
  return (req as SessionAuthenticatedRequest).sessionUser?.orgId;
}

export const ProjectSlug = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'project slug must be lowercase letters, numbers, and dashes');

export interface ProjectAccess {
  readonly orgId?: string;
  readonly slug: string;
  readonly storageSlug: string;
}

export async function resolveProjectAccess(
  ctx: AppContext,
  req: FastifyRequest,
  slug: string,
): Promise<ProjectAccess> {
  const apiKey = (req as AuthenticatedRequest).apiKey;
  const orgId = callerOrgId(req);
  if (!orgId) return { slug, storageSlug: slug };

  const [project] = await ctx.db
    .select({
      id: schema.projects.id,
      orgId: schema.projects.orgId,
      slug: schema.projects.slug,
    })
    .from(schema.projects)
    .where(and(eq(schema.projects.orgId, orgId), eq(schema.projects.slug, slug)))
    .limit(1);

  if (!project) throw new NotFoundError('project', slug);
  // Project pinning — if the presenting key is scoped to a subset of the org's
  // projects, refuse access to anything outside that subset even when the
  // caller's org would otherwise permit it. Returning 404 here would leak the
  // existence of the project to a key that isn't allowed to see it, so 403.
  if (apiKey?.projectIds && !apiKey.projectIds.includes(project.id)) {
    throw new CarbonError({
      code: 'CARBON_FORBIDDEN',
      message: 'API key not scoped to this project',
      details: { projectId: project.id },
      expose: true,
    });
  }
  // Per-project ACL. Presence of any project_members row for a project means
  // access is no longer org-wide — a session user must be listed (owners/
  // admins retain access via their org role). API-key callers are already
  // gated by project pinning above.
  const session = (req as SessionAuthenticatedRequest).sessionUser;
  if (session && session.role !== 'owner' && session.role !== 'admin') {
    const members = await ctx.db
      .select({ userId: schema.projectMembers.userId })
      .from(schema.projectMembers)
      .where(eq(schema.projectMembers.projectId, project.id))
      .limit(1);
    if (members.length > 0) {
      const [own] = await ctx.db
        .select({ userId: schema.projectMembers.userId })
        .from(schema.projectMembers)
        .where(
          and(
            eq(schema.projectMembers.projectId, project.id),
            eq(schema.projectMembers.userId, session.id),
          ),
        )
        .limit(1);
      if (!own) {
        throw new CarbonError({
          code: 'CARBON_FORBIDDEN',
          message: 'Not a member of this project',
          details: { projectId: project.id },
          expose: true,
        });
      }
    }
  }
  return {
    orgId: project.orgId,
    slug: project.slug,
    storageSlug: `${project.orgId}/${project.slug}`,
  };
}

export async function resolveStoredProjectAccess(
  ctx: AppContext,
  req: FastifyRequest,
  storageSlug: string,
): Promise<ProjectAccess> {
  const orgId = callerOrgId(req);
  if (!orgId) return { slug: publicProjectSlug(storageSlug), storageSlug };

  const prefix = `${orgId}/`;
  if (!storageSlug.startsWith(prefix)) {
    throw new NotFoundError('project', publicProjectSlug(storageSlug));
  }
  return resolveProjectAccess(ctx, req, storageSlug.slice(prefix.length));
}

/**
 * Narrows a list of storage-scoped records to the ones the caller's org owns,
 * rewriting each `projectSlug` back to its public form.
 *
 * Resolved with a single `IN (...)` query rather than one lookup per record —
 * listing 50 emulators previously issued 50 sequential round-trips to
 * Postgres, and the list endpoint's latency grew linearly with its own result
 * set.
 */
export async function filterStoredProjectRecords<T extends { readonly projectSlug: string }>(
  ctx: AppContext,
  req: FastifyRequest,
  records: readonly T[],
): Promise<T[]> {
  const orgId = callerOrgId(req);
  if (!orgId) {
    return records.map((record) => ({
      ...record,
      projectSlug: publicProjectSlug(record.projectSlug),
    }));
  }
  if (records.length === 0) return [];

  const prefix = `${orgId}/`;
  // Slugs outside the caller's org can be rejected without touching the DB.
  const candidates = new Set<string>();
  for (const record of records) {
    if (record.projectSlug.startsWith(prefix)) {
      candidates.add(record.projectSlug.slice(prefix.length));
    }
  }
  if (candidates.size === 0) return [];

  const rows = await ctx.db
    .select({ id: schema.projects.id, slug: schema.projects.slug })
    .from(schema.projects)
    .where(and(eq(schema.projects.orgId, orgId), inArray(schema.projects.slug, [...candidates])));
  const pinned = (req as AuthenticatedRequest).apiKey?.projectIds ?? null;
  const owned = new Set(
    rows.filter((row) => (pinned ? pinned.includes(row.id) : true)).map((row) => row.slug),
  );

  const filtered: T[] = [];
  for (const record of records) {
    if (!record.projectSlug.startsWith(prefix)) continue;
    const slug = record.projectSlug.slice(prefix.length);
    if (!owned.has(slug)) continue;
    filtered.push({ ...record, projectSlug: slug });
  }
  return filtered;
}

export function publicProjectSlug(storageSlug: string): string {
  const slash = storageSlug.indexOf('/');
  return slash === -1 ? storageSlug : storageSlug.slice(slash + 1);
}
