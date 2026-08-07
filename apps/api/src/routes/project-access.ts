import type { FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
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

export async function filterStoredProjectRecords<T extends { readonly projectSlug: string }>(
  ctx: AppContext,
  req: FastifyRequest,
  records: readonly T[],
): Promise<T[]> {
  const filtered: T[] = [];
  for (const record of records) {
    try {
      const project = await resolveStoredProjectAccess(ctx, req, record.projectSlug);
      filtered.push({ ...record, projectSlug: project.slug });
    } catch (err) {
      if (err instanceof NotFoundError) continue;
      throw err;
    }
  }
  return filtered;
}

export function publicProjectSlug(storageSlug: string): string {
  const slash = storageSlug.indexOf('/');
  return slash === -1 ? storageSlug : storageSlug.slice(slash + 1);
}
