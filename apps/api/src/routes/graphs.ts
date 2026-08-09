import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '@carbon/core';
import { BehaviorGraphBuilder } from '@carbon/graph';
import { StorageKeys } from '@carbon/storage';
import type { AppContext } from '../context.js';
import { requireScope } from '../plugins/scopes.js';
import { zodResponse } from '../plugins/schema-helpers.js';
import { ProjectSlug, resolveProjectAccess } from './project-access.js';

const GraphResponse = z.object({
  projectId: z.string(),
  irId: z.string().optional(),
  nodes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      readers: z.number().int(),
      writers: z.number().int(),
    }),
  ),
  edges: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      kind: z.string(),
    }),
  ),
  transitions: z.number().int(),
  constraints: z.number().int(),
  graphKey: z.string(),
});

/**
 * Serve a project's most-recent behavior graph in a shape the dashboard's
 * graph explorer can render directly (nodes + edges + endpoint counts).
 *
 * The graph is rebuilt from the persisted IR rather than the persisted
 * graph blob so we can shape the payload independently of the artifact
 * format — and so tests can assert the response matches the deterministic
 * BehaviorGraphBuilder output.
 */
export async function registerGraphRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/v1/projects/:id/graph',
    {
      preHandler: requireScope('read'),
      schema: {
        summary: 'Get a project\'s current behavior graph',
        description:
          'Rebuild and return the behavior graph derived from the project\'s most recent IR blob. Shape is stable enough for the dashboard\'s graph explorer to render directly.',
        response: { 200: zodResponse(GraphResponse) },
      },
    },
    async (req) => {
      const params = z.object({ id: ProjectSlug }).parse(req.params);
      const project = await resolveProjectAccess(ctx, req, params.id);

      // Find the newest IR blob for this project.
      const prefix = `projects/${project.storageSlug}/ir/`;
      let latest: { key: string; modifiedAt: number } | null = null;
      for await (const obj of ctx.storage.list(prefix)) {
        if (!latest || obj.modifiedAt > latest.modifiedAt) {
          latest = { key: obj.key, modifiedAt: obj.modifiedAt };
        }
      }
      if (!latest) throw new NotFoundError('graph', params.id);

      const bytes = await ctx.storage.get(latest.key);
      if (!bytes) throw new NotFoundError('graph', params.id);
      const ir = JSON.parse(new TextDecoder().decode(bytes));
      const graph = new BehaviorGraphBuilder().build(ir);

      const irId = latest.key
        .split('/')
        .pop()
        ?.replace(/\.json$/, '');

      return {
        projectId: params.id,
        irId,
        nodes: graph.nodes.map((n) => ({
          id: n.id,
          name: n.name,
          readers: n.readers.length,
          writers: n.writers.length,
        })),
        edges: graph.edges.map((e) => ({
          from: e.from,
          to: e.to,
          kind: e.kind,
        })),
        transitions: graph.transitions.length,
        constraints: graph.constraints.length,
        graphKey: StorageKeys.graph(project.storageSlug, irId ?? 'latest'),
      };
    },
  );
}
