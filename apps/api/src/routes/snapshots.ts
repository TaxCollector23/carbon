import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '@carbon/core';
import { diffSnapshots, parseSnapshot, serializeSnapshot, type StateSnapshot } from '@carbon/state';
import { StorageKeys } from '@carbon/storage';
import type { AppContext } from '../context.js';
import { requireScope } from '../plugins/scopes.js';
import {
  zodBody,
  zodQuery,
  zodResponse,
  zodResponseWithExample,
} from '../plugins/schema-helpers.js';
import { getActor, recordEvent } from '../services/events.js';
import { recordUsage } from '../services/usage.js';
import { ProjectSlug, resolveProjectAccess } from './project-access.js';
import { collectStorage } from './storage-listing.js';

/**
 * Snapshot names appear in storage keys, so they must be lowercase, start with
 * an alphanumeric, and contain only `[a-z0-9-]`. Applied to *every* route that
 * takes a name — read and delete included — to keep path traversal shapes off
 * the surface area.
 */
const SnapshotName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'invalid snapshot name');

const CreateSnapshotBody = z.object({
  projectSlug: ProjectSlug,
  name: SnapshotName,
  snapshot: z.object({
    version: z.literal(1),
    takenAt: z.number(),
    records: z.array(
      z.object({
        resource: z.string(),
        id: z.string(),
        data: z.record(z.unknown()),
        createdAt: z.number(),
        updatedAt: z.number(),
      }),
    ),
  }),
});

const SnapshotListItem = z.object({
  name: z.string(),
  size: z.number().int(),
  modifiedAt: z.number(),
});
const SnapshotListResponse = z.object({
  data: z.array(SnapshotListItem),
  limit: z.number().int(),
  truncated: z.boolean(),
});
const SnapshotCreateResponse = z.object({
  name: z.string(),
  storageKey: z.string(),
});
const SnapshotListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function registerSnapshotRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Params: { slug: string }; Querystring: { limit?: string } }>(
    '/v1/projects/:slug/snapshots',
    {
      preHandler: requireScope('read'),
      schema: {
        summary: 'List project snapshots',
        description:
          'Enumerate saved snapshots for a project. Bounded scan — pass `limit` (max 500) to stop early; ' +
          '`truncated: true` means more snapshots exist beyond the limit.',
        querystring: zodQuery(SnapshotListQuery),
        response: {
          200: zodResponseWithExample(SnapshotListResponse, {
            data: [
              {
                name: 'seed-cart-full',
                size: 4212,
                modifiedAt: 1731601361000,
              },
              {
                name: 'post-checkout',
                size: 5893,
                modifiedAt: 1731597811000,
              },
            ],
            limit: 100,
            truncated: false,
          }),
        },
      },
    },
    async (req) => {
      const params = z.object({ slug: ProjectSlug }).parse(req.params);
      const query = z
        .object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
        .parse(req.query);
      const project = await resolveProjectAccess(ctx, req, params.slug);

      // Bounded scan. On S3 an unbounded `list` paginates through every object
      // under the prefix, so a project with 50k snapshots would hold the
      // connection open for minutes and buffer the whole listing in memory.
      const items: Array<{ name: string; size: number; modifiedAt: number }> = [];
      const scanned = await collectStorage(
        ctx.storage.list(`projects/${project.storageSlug}/snapshots/`),
        query.limit,
        (obj) => {
          const name = obj.key
            .split('/')
            .pop()
            ?.replace(/\.json$/, '');
          if (name) items.push({ name, size: obj.size, modifiedAt: obj.modifiedAt });
        },
      );

      items.sort((a, b) => b.modifiedAt - a.modifiedAt);
      return { data: items, limit: query.limit, truncated: scanned >= query.limit };
    },
  );

  app.post(
    '/v1/snapshots',
    {
      preHandler: requireScope('write'),
      schema: {
        summary: 'Save a snapshot',
        description:
          'Persist a `StateSnapshot` for the given project under `name`. Overwrites any existing snapshot with the same name; ' +
          'name must match /^[a-z0-9][a-z0-9-]{0,63}$/ since it is used as a storage key segment.',
        body: zodBody(CreateSnapshotBody),
        response: { 201: zodResponse(SnapshotCreateResponse) },
      },
    },
    async (req, reply) => {
      const body = CreateSnapshotBody.parse(req.body);
      const project = await resolveProjectAccess(ctx, req, body.projectSlug);
      const key = StorageKeys.snapshot(project.storageSlug, body.name);
      await ctx.storage.put(key, serializeSnapshot(body.snapshot as unknown as StateSnapshot), {
        contentType: 'application/json',
      });
      if (project.orgId) {
        const actor = getActor(req);
        await recordEvent(ctx, {
          orgId: project.orgId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: 'snapshot.saved',
          metadata: { projectSlug: project.slug, name: body.name },
        });
        await recordUsage(ctx, {
          orgId: project.orgId,
          kind: 'snapshot_saved',
          amount: 1,
          metadata: { projectSlug: project.slug, name: body.name },
        });
      }
      reply.status(201);
      return { name: body.name, storageKey: key };
    },
  );

  app.get<{ Params: { slug: string; name: string } }>(
    '/v1/projects/:slug/snapshots/:name',
    { preHandler: requireScope('read') },
    async (req) => {
      const params = z.object({ slug: ProjectSlug, name: SnapshotName }).parse(req.params);
      const project = await resolveProjectAccess(ctx, req, params.slug);
      const key = StorageKeys.snapshot(project.storageSlug, params.name);
      const bytes = await ctx.storage.get(key);
      if (!bytes) throw new NotFoundError('snapshot', params.name);
      const text = new TextDecoder().decode(bytes);
      return parseSnapshot(text);
    },
  );

  app.get<{ Params: { slug: string }; Querystring: { a?: string; b?: string } }>(
    '/v1/snapshots/:slug/diff',
    { preHandler: requireScope('read') },
    async (req) => {
      const params = z.object({ slug: ProjectSlug }).parse(req.params);
      const query = z.object({ a: SnapshotName, b: SnapshotName }).parse(req.query);
      const project = await resolveProjectAccess(ctx, req, params.slug);

      const [aBytes, bBytes] = await Promise.all([
        ctx.storage.get(StorageKeys.snapshot(project.storageSlug, query.a)),
        ctx.storage.get(StorageKeys.snapshot(project.storageSlug, query.b)),
      ]);
      if (!aBytes) throw new NotFoundError('snapshot', query.a);
      if (!bBytes) throw new NotFoundError('snapshot', query.b);

      const a = parseSnapshot(new TextDecoder().decode(aBytes));
      const b = parseSnapshot(new TextDecoder().decode(bBytes));
      const diff = diffSnapshots(a, b);
      // Attach the requested names so the dashboard can label the two sides
      // without threading them through as separate props.
      return {
        ...diff,
        a: { ...diff.a, name: query.a },
        b: { ...diff.b, name: query.b },
      };
    },
  );

  app.delete<{ Params: { slug: string; name: string } }>(
    '/v1/projects/:slug/snapshots/:name',
    { preHandler: requireScope('write') },
    async (req, reply) => {
      const params = z.object({ slug: ProjectSlug, name: SnapshotName }).parse(req.params);
      const project = await resolveProjectAccess(ctx, req, params.slug);
      const key = StorageKeys.snapshot(project.storageSlug, params.name);
      const head = await ctx.storage.head(key);
      if (!head) throw new NotFoundError('snapshot', params.name);
      await ctx.storage.delete(key);
      if (project.orgId) {
        const actor = getActor(req);
        await recordEvent(ctx, {
          orgId: project.orgId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: 'snapshot.deleted',
          metadata: { projectSlug: project.slug, name: params.name },
        });
      }
      reply.status(204);
    },
  );
}
