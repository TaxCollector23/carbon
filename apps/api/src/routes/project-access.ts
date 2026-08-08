import type { FastifyRequest } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';

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
  const orgId = (req as AuthenticatedRequest).apiKey?.orgId;
  if (!orgId) return { slug, storageSlug: slug };

  const [project] = await ctx.db
    .select({
      orgId: schema.projects.orgId,
      slug: schema.projects.slug,
    })
    .from(schema.projects)
    .where(and(eq(schema.projects.orgId, orgId), eq(schema.projects.slug, slug)))
    .limit(1);

  if (!project) throw new NotFoundError('project', slug);
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
  const orgId = (req as AuthenticatedRequest).apiKey?.orgId;
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
  const orgId = (req as AuthenticatedRequest).apiKey?.orgId;
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
    .select({ slug: schema.projects.slug })
    .from(schema.projects)
    .where(and(eq(schema.projects.orgId, orgId), inArray(schema.projects.slug, [...candidates])));
  const owned = new Set(rows.map((row) => row.slug));

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
