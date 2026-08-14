import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import WebSocket from 'ws';
import { NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import { validateAgainstSpec, type JsonSchemaLike } from '@carbon/parser';
import type { AppContext } from '../context.js';
import { requireScope } from '../plugins/scopes.js';
import { zodBodyWithExample, zodResponse } from '../plugins/schema-helpers.js';
import { recordUsage } from '../services/usage.js';
import { requireProjectAccessById } from './project-access.js';

const SampleReportSchema = z.object({
  method: z.string(),
  path: z.string(),
  status: z.number().int().nullable(),
  durationMs: z.number(),
  ok: z.boolean(),
  error: z.string().optional(),
  mismatches: z
    .array(z.object({ path: z.string(), expected: z.string(), got: z.string() }))
    .optional(),
});

const WsFrameReportSchema = z.object({
  index: z.number().int(),
  ok: z.boolean(),
  raw: z.string(),
  parsed: z.unknown().optional(),
  mismatches: z
    .array(z.object({ path: z.string(), expected: z.string(), got: z.string() }))
    .optional(),
});

const WsCheckReportSchema = z.object({
  url: z.string(),
  ok: z.boolean(),
  framesReceived: z.number().int(),
  framesExpected: z.number().int(),
  durationMs: z.number(),
  error: z.string().optional(),
  frames: z.array(WsFrameReportSchema),
});

const ContractCheckResponse = z.object({
  projectId: z.string(),
  target: z.string(),
  summary: z.object({
    total: z.number().int(),
    passed: z.number().int(),
    failed: z.number().int(),
  }),
  results: z.array(SampleReportSchema),
  ws: z.array(WsCheckReportSchema).optional(),
});

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

const WsCheck = z.object({
  url: z.string().url(),
  protocols: z.array(z.string()).optional(),
  sendMessage: z.union([z.string(), z.record(z.unknown())]).optional(),
  expectFrames: z.number().int().min(1).max(100),
  expectSchema: z.unknown().optional(),
  timeoutMs: z.number().int().min(100).max(30_000).default(5_000),
});

const CheckBody = z.object({
  url: z.string().url(),
  timeoutMs: z.number().int().min(100).max(30_000).default(5_000),
  sampleRequests: z
    .array(SampleRequest)
    .min(1)
    .max(50)
    .default([{ method: 'GET', path: '/' }]),
  wsChecks: z.array(WsCheck).max(10).optional(),
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

interface WsFrameReport {
  index: number;
  ok: boolean;
  raw: string;
  parsed?: unknown;
  mismatches?: readonly { path: string; expected: string; got: string }[];
}

interface WsCheckReport {
  url: string;
  ok: boolean;
  framesReceived: number;
  framesExpected: number;
  durationMs: number;
  error?: string;
  frames: WsFrameReport[];
}

async function runWsCheck(check: z.infer<typeof WsCheck>): Promise<WsCheckReport> {
  const started = Date.now();
  const frames: WsFrameReport[] = [];
  const schemaLike = check.expectSchema as JsonSchemaLike | undefined;

  return new Promise<WsCheckReport>((resolve) => {
    let settled = false;
    let ws: WebSocket | null = null;
    const finish = (error?: string): void => {
      if (settled) return;
      settled = true;
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      const framesOk = frames.length >= check.expectFrames && frames.every((f) => f.ok);
      resolve({
        url: check.url,
        ok: framesOk && !error,
        framesReceived: frames.length,
        framesExpected: check.expectFrames,
        durationMs: Date.now() - started,
        error,
        frames,
      });
    };

    const timer = setTimeout(
      () => finish(frames.length < check.expectFrames ? 'timeout' : undefined),
      check.timeoutMs,
    );

    try {
      ws = new WebSocket(check.url, check.protocols);
    } catch (err) {
      clearTimeout(timer);
      finish(err instanceof Error ? err.message : String(err));
      return;
    }

    ws.on('open', () => {
      if (check.sendMessage !== undefined) {
        const payload =
          typeof check.sendMessage === 'string'
            ? check.sendMessage
            : JSON.stringify(check.sendMessage);
        try {
          ws?.send(payload);
        } catch (err) {
          clearTimeout(timer);
          finish(err instanceof Error ? err.message : String(err));
        }
      }
    });

    ws.on('message', (data) => {
      const raw = data.toString();
      let parsed: unknown = raw;
      try {
        parsed = raw.length > 0 ? JSON.parse(raw) : null;
      } catch {
        parsed = raw;
      }
      let ok = true;
      let mismatches: WsFrameReport['mismatches'];
      if (schemaLike) {
        const result = validateAgainstSpec(schemaLike, parsed);
        ok = result.ok;
        mismatches = result.mismatches;
      }
      frames.push({ index: frames.length, ok, raw, parsed, mismatches });
      if (frames.length >= check.expectFrames) {
        clearTimeout(timer);
        finish();
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      finish(err instanceof Error ? err.message : String(err));
    });

    ws.on('close', () => {
      if (!settled) {
        clearTimeout(timer);
        finish(frames.length < check.expectFrames ? 'closed before expected frames' : undefined);
      }
    });
  });
}

export async function registerContractRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post<{ Params: { id: string } }>(
    '/v1/projects/:id/contract-check',
    {
      preHandler: requireScope('write'),
      schema: {
        summary: 'Run contract checks against a live URL',
        description:
          'Send each sample request in the body to the target URL and report status, latency, and (optionally) schema mismatches. Optional wsChecks open a WebSocket, send a first message, and validate incoming frames against a schema. Counts as one contract_check usage event per sample or ws-check.',
        body: zodBodyWithExample(CheckBody, {
          url: 'https://staging.api.acme.example',
          timeoutMs: 5000,
          sampleRequests: [
            { method: 'GET', path: '/health' },
            {
              method: 'POST',
              path: '/orders',
              body: { sku: 'sku_widget', qty: 1 },
              expectedSchema: {
                type: 'object',
                required: ['id', 'status'],
                properties: {
                  id: { type: 'string' },
                  status: { type: 'string', enum: ['pending', 'confirmed'] },
                },
              },
            },
          ],
          wsChecks: [
            {
              url: 'wss://staging.api.acme.example/ws',
              sendMessage: { type: 'subscribe', channel: 'orders' },
              expectFrames: 1,
              expectSchema: {
                type: 'object',
                required: ['type'],
                properties: { type: { type: 'string' } },
              },
              timeoutMs: 3000,
            },
          ],
        }),
        response: { 200: zodResponse(ContractCheckResponse) },
      },
    },
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

      let wsReports: WsCheckReport[] | undefined;
      if (body.wsChecks && body.wsChecks.length > 0) {
        wsReports = await Promise.all(body.wsChecks.map(runWsCheck));
        for (const w of wsReports) if (w.ok) passed += 1;
      }

      const totalWs = wsReports?.length ?? 0;
      const total = reports.length + totalWs;

      if (access.orgId && total > 0) {
        await recordUsage(ctx, {
          orgId: access.orgId,
          kind: 'contract_check',
          amount: total,
          metadata: {
            projectId: project.id,
            projectSlug: access.slug,
            target: baseUrl,
            passed,
            failed: total - passed,
            wsChecks: totalWs,
          },
        });
      }
      return {
        projectId: project.id,
        target: baseUrl,
        summary: {
          total,
          passed,
          failed: total - passed,
        },
        results: reports,
        ...(wsReports ? { ws: wsReports } : {}),
      };
    },
  );
}
