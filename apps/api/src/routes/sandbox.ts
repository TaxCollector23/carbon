import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { InvalidInputError } from '@carbon/core';
import { zodBody, zodResponse } from '../plugins/schema-helpers.js';
import type { AppContext } from '../context.js';
import { loadSampleSpec, SAMPLES } from './samples.js';
import {
  createSandboxRegistry,
  type SandboxRegistry,
  type SandboxRecord,
} from '../services/sandbox-registry.js';

const SAMPLE_IDS: ReadonlySet<string> = new Set(SAMPLES.map((s) => s.id));

const CreateBody = z.object({
  sample: z.string().min(1).max(40).default('petstore'),
});

const SandboxSummary = z.object({
  id: z.string(),
  url: z.string(),
  sample: z.string(),
  spec: z.string(),
  startedAt: z.number(),
  lastActivityAt: z.number(),
  requestCount: z.number().int(),
});

const ProxyResponse = z.object({
  id: z.string(),
  method: z.string(),
  path: z.string(),
  status: z.number().int(),
  latencyMs: z.number(),
  headers: z.record(z.string()),
  body: z.unknown(),
});

export interface SandboxOptions {
  /** Ceiling on concurrently running sandboxes. Default 16. */
  readonly maxSandboxes?: number;
  /** Idle TTL before a sandbox is swept. Default 15 minutes. */
  readonly idleTtlMs?: number;
  /** How often to sweep idle sandboxes. Default 60s. */
  readonly sweepIntervalMs?: number;
  /** Test hook: inject a registry instead of creating one. */
  readonly registry?: SandboxRegistry;
}

/**
 * Public "test drive" sandbox routes for the marketing site's console.
 *
 * No API key, no org, no database: `POST /v1/sandbox` boots a real Carbon
 * runtime from a bundled sample spec, and every other method under
 * `/v1/sandbox/:id/*` (including the `/__carbon/*` state routes) is proxied
 * to that runtime over real HTTP, with the response wrapped so the browser
 * gets latency + status + body in one parseable payload. Sandboxes are
 * bounded (capacity error) and evicted after an idle TTL.
 *
 * These routes are public and therefore per-IP rate limited like every other
 * anonymous endpoint (see `RATE_LIMITED_PUBLIC_PATHS` in server.ts).
 */
export async function registerSandboxRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  options: SandboxOptions = {},
): Promise<void> {
  const registry = options.registry ?? createSandboxRegistry({
    logger: ctx.logger,
    maxSandboxes: options.maxSandboxes ?? 16,
    idleTtlMs: options.idleTtlMs ?? 15 * 60 * 1000,
  });

  const sweepTimer = setInterval(() => {
    void registry.sweep().catch((err: unknown) => {
      ctx.logger.warn('sandbox.sweep_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }, options.sweepIntervalMs ?? 60_000);
  sweepTimer.unref?.();

  app.addHook('onClose', async () => {
    clearInterval(sweepTimer);
    await registry.shutdown();
  });

  app.get(
    '/v1/sandbox/stats',
    {
      schema: {
        summary: 'Sandbox usage stats',
        description:
          'Return aggregate stats about active sandboxes — total count, total requests served, ' +
          'and top samples by creation count. Useful for the landing page social proof.',
      },
    },
    async () => registry.getStats(),
  );

  app.post(
    '/v1/sandbox',
    {
      schema: {
        summary: 'Start a public sandbox',
        description:
          'Boot a real Carbon runtime from a bundled sample spec (petstore, stripe, github, shopify, openai, twilio). Anonymous, no auth, no storage. Bounded by capacity and evicted after an idle TTL.',
        body: zodBody(CreateBody),
        response: { 201: zodResponse(SandboxSummary) },
      },
    },
    async (req, reply) => {
      const { sample } = CreateBody.parse(req.body ?? {});
      if (!SAMPLE_IDS.has(sample)) {
        throw new InvalidInputError(
          `sample must be one of: ${Array.from(SAMPLE_IDS).join(', ')}`,
          { sample, allowed: Array.from(SAMPLE_IDS) },
        );
      }
      const spec = loadSampleSpec(sample);
      await registry.sweep();
      const record = await registry.create(spec, sample);
      reply.status(201);
      return record;
    },
  );

  app.get<{ Params: { id: string } }>(
    '/v1/sandbox/:id',
    {
      schema: {
        summary: 'Get a sandbox',
        description: "Return the sandbox's live binding and activity counters.",
        response: { 200: zodResponse(SandboxSummary) },
      },
    },
    async (req) => registry.get(req.params.id),
  );

  app.get<{ Params: { id: string } }>(
    '/v1/sandbox/:id/spec',
    {
      schema: {
        summary: 'Get the spec for a sandbox',
        description:
          'Return the OpenAPI/GraphQL spec that the sandbox was booted from. ' +
          'Useful for the console to show which API surface is being emulated.',
      },
    },
    async (req) => {
      const record = registry.get(req.params.id);
      const spec = loadSampleSpec(record.sample);
      return spec;
    },
  );

  app.get<{ Params: { id: string } }>(
    '/v1/sandbox/:id/endpoints',
    {
      schema: {
        summary: 'List sandbox endpoints',
        description:
          'Return the parsed endpoints from the spec the sandbox was booted from. ' +
          'Useful for the console to build a dynamic method/path picker.',
      },
    },
    async (req) => {
      return { data: registry.getEndpoints(req.params.id) };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/v1/sandbox/:id/state',
    {
      schema: {
        summary: 'Get sandbox state',
        description:
          'Return the current in-memory state of all resources in the sandbox. ' +
          'Useful for the console to display a live state panel without proxying.',
      },
    },
    async (req) => {
      const state = registry.getState(req.params.id) as {
        snapshot?: () => Promise<{ records: unknown[] }>; 
      };
      if (!state || typeof state.snapshot !== 'function') {
        return { records: [] };
      }
      const snap = await state.snapshot();
      return { records: snap.records };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/v1/sandbox/:id/log',
    {
      schema: {
        summary: 'Get sandbox request log',
        description:
          'Return the audit log of proxied requests (most recent first). ' +
          'Useful for the console to display a request history panel.',
      },
    },
    async (req) => {
      const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 100;
      const log = registry.getRequestLog(req.params.id, limit);
      return { data: log, total: log.length };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/v1/sandbox/:id',
    {
      schema: {
        summary: 'Stop a sandbox',
        description: 'Shut down and remove a sandbox, freeing its port.',
      },
    },
    async (req, reply) => {
      await registry.stop(req.params.id);
      reply.status(204);
    },
  );

  // Everything else on the sandbox — app routes AND the `/__carbon/*` state
  // routes (health, history, rewind, snapshot, reset, inspect) — is proxied
  // to the real runtime. Fastify's trailing `*` param captures the remainder
  // of the path; the query string is appended separately.
  app.all<{ Params: { id: string; '*': string } }>(
    '/v1/sandbox/:id/*',
    {
      schema: {
        summary: 'Proxy a request to a sandbox runtime',
        description:
          'Forward any method/path to the sandboxed runtime and return the real response wrapped with latency. Includes the /__carbon/* state-control routes.',
        response: { 200: zodResponse(ProxyResponse) },
      },
    },
    async (req, reply) => {
      const id = req.params.id;
      const rest = (req.params['*'] ?? '').replace(/^\/+/, '');
      const rawPath = rest.length > 0 ? `/${rest}` : '/';
      const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      const path = `${rawPath}${query}`;
      const method = req.method;

      const rawBody = req.body;
      const body =
        typeof rawBody === 'string'
          ? rawBody
          : rawBody === undefined
            ? undefined
            : JSON.stringify(rawBody);
      const contentType =
        typeof req.headers['content-type'] === 'string'
          ? req.headers['content-type']
          : undefined;

      const result = await registry.proxy(id, method, path, body, contentType);
      reply.status(result.status);
      return { id, method, path, status: result.status, latencyMs: result.latencyMs, headers: result.headers, body: result.body };
    },
  );
}

export type { SandboxRecord };
