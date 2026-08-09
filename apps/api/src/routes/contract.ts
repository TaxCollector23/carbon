import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import { validateAgainstSpec, type JsonSchemaLike } from '@carbon/parser';
import type { AppContext } from '../context.js';
import { requireScope } from '../plugins/scopes.js';
import { recordUsage } from '../services/usage.js';
import { requireProjectAccessById } from './project-access.js';

const SampleRequest = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET'),
  path: z.string().min(1).max(500),
  body: z.unknown().optional(),
  headers: z.record(z.string()).optional(),
  /**
   * Expected JSON-Schema-shaped fragment the response body must satisfy. If
   * absent, the sample only reports the actual status/latency.
   */
  expectedSchema: z.unknown().optional(),
});

const CheckBody = z.object({
  url: z.string().url(),
  timeoutMs: z.number().int().min(100).max(30_000).default(5_000),
  sampleRequests: z.array(SampleRequest).min(1).max(50).default([{ method: 'GET', path: '/' }]),
});

interface SampleReport {
  method: string;
  path: string;
  status: number | null;
  durationMs: number;
  ok: boolean;
  error?: string;
  mismatches?: readonly { path: string; expected: string; got: string }[];
}

export async function registerContractRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.post<{ Params: { id: string } }>(
    '/v1/projects/:id/contract-check',
    { preHandler: requireScope('write') },
    async (req) => {
      const body = CheckBody.parse(req.body);
      // ACL: caller's org must own this project, and if project_members
      // narrows access the session user must be listed.
      const access = await requireProjectAccessById(ctx, req, req.params.id);
      const [project] = await ctx.db
        .select({ id: schema.projects.id, name: schema.projects.name })
        .from(schema.projects)
        .where(eq(schema.projects.id, req.params.id))
        .limit(1);
      if (!project) throw new NotFoundError('project', req.params.id);

      const baseUrl = body.url.replace(/\/+$/, '');
      const reports: SampleReport[] = [];
      let passed = 0;
      for (const sample of body.sampleRequests) {
        const url = `${baseUrl}${sample.path.startsWith('/') ? '' : '/'}${sample.path}`;
        const started = Date.now();
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), body.timeoutMs);
          try {
            const res = await fetch(url, {
              method: sample.method,
              headers: {
                'content-type': 'application/json',
                ...(sample.headers ?? {}),
              },
              body:
                sample.body !== undefined && sample.method !== 'GET' && sample.method !== 'HEAD'
                  ? JSON.stringify(sample.body)
                  : undefined,
              signal: controller.signal,
            });
            const durationMs = Date.now() - started;
            let ok = res.ok;
            let mismatches: SampleReport['mismatches'];
            if (sample.expectedSchema) {
              const text = await res.text();
              let parsed: unknown;
              try {
                parsed = text.length > 0 ? JSON.parse(text) : null;
              } catch {
                parsed = text;
              }
              const result = validateAgainstSpec(sample.expectedSchema as JsonSchemaLike, parsed);
              mismatches = result.mismatches;
              ok = ok && result.ok;
            }
            if (ok) passed += 1;
            reports.push({
              method: sample.method,
              path: sample.path,
              status: res.status,
              durationMs,
              ok,
              mismatches,
            });
          } finally {
            clearTimeout(timeout);
          }
        } catch (err) {
          reports.push({
            method: sample.method,
            path: sample.path,
            status: null,
            durationMs: Date.now() - started,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (access.orgId) {
        await recordUsage(ctx, {
          orgId: access.orgId,
          kind: 'contract_check',
          amount: reports.length,
          metadata: {
            projectId: project.id,
            projectSlug: access.slug,
            target: baseUrl,
            passed,
            failed: reports.length - passed,
          },
        });
      }
      return {
        projectId: project.id,
        target: baseUrl,
        summary: {
          total: reports.length,
          passed,
          failed: reports.length - passed,
        },
        results: reports,
      };
    },
  );
}

