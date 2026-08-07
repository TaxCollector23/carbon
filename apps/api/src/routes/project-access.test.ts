import { describe, expect, it } from 'vitest';
import { NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { filterStoredProjectRecords, resolveProjectAccess } from './project-access.js';

function makeCtx(projects: Array<{ orgId: string; slug: string }>): AppContext {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => projects,
  };
  return {
    logger: NoopLogger,
    db: { select: () => chain } as unknown as AppContext['db'],
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

function req(orgId: string): FastifyRequest {
  return { apiKey: { id: 'key_1', orgId, prefix: 'aa11bb22cc33' } } as AuthenticatedRequest;
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
});
