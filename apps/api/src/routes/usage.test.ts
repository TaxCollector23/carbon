import { describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { schema } from '@carbon/database';
import { AiCapabilities, AiJudge } from '@carbon/ai';
import type { AiProvider, CompletionRequest, CompletionResponse, StructuredRequest, UsageEvent } from '@carbon/ai';
import { createIngestionPipeline } from '@carbon/ingestion';
import { OpenApiParser, ParserRegistry } from '@carbon/parser';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { recordUsage } from '../services/usage.js';
import { registerUsageRoutes } from './usage.js';
import { registerIngestRoutes } from './ingest.js';

interface UsageRow {
  id: string;
  orgId: string;
  kind: string;
  amount: number;
  metadata: unknown;
  occurredAt: Date;
}

interface Store {
  rows: UsageRow[];
  filter: (r: UsageRow) => boolean;
}

function makeDb(store: Store): AppContext['db'] {
  return {
    select: (cols?: unknown) => {
      const grouped = typeof cols === 'object' && cols !== null && 'total' in (cols as object);
      const chain: any = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        groupBy: async () => {
          const filtered = store.rows.filter(store.filter);
          const totals = new Map<string, number>();
          for (const r of filtered) {
            totals.set(r.kind, (totals.get(r.kind) ?? 0) + r.amount);
          }
          return [...totals.entries()].map(([kind, total]) => ({ kind, total: String(total) }));
        },
        limit: async (n: number) => {
          if (grouped) {
            // Not exercised — grouped queries terminate on groupBy.
            return [];
          }
          const sorted = [...store.rows]
            .filter(store.filter)
            .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
          return sorted.slice(0, n);
        },
      };
      return chain;
    },
    insert: (table: unknown) => ({
      values: async (v: UsageRow) => {
        if (table === schema.usageEvents) {
          store.rows.push({
            id: v.id,
            orgId: v.orgId,
            kind: v.kind,
            amount: v.amount ?? 1,
            metadata: v.metadata ?? {},
            occurredAt: new Date(Date.now() + store.rows.length),
          });
        }
      },
    }),
  } as unknown as AppContext['db'];
}

function makeCtx(store: Store): AppContext {
  return {
    logger: NoopLogger,
    db: makeDb(store),
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

async function build(store: Store, orgId: string): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', message: err.message } });
      return;
    }
    if (isCarbonError(err)) {
      const status =
        err.code === 'CARBON_INVALID_INPUT'
          ? 400
          : err.code === 'CARBON_FORBIDDEN'
            ? 403
            : 500;
      reply.status(status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
  });
  app.addHook('onRequest', async (req) => {
    (req as AuthenticatedRequest).apiKey = {
      id: 'k',
      orgId,
      prefix: 'aa11bb22cc33',
      scopes: ['admin'],
      projectIds: null,
      expiresAt: null,
    };
    // Emulate the api-key hook's org pin for the filter closure.
    store.filter = (r: UsageRow) => r.orgId === orgId;
  });
  await registerUsageRoutes(app, makeCtx(store));
  await app.ready();
  return app;
}

describe('usage routes', () => {
  it('aggregates SUM(amount) grouped by kind for the caller org only', async () => {
    const store: Store = { rows: [], filter: () => true };
    const ctx = makeCtx(store);
    await recordUsage(ctx, { orgId: 'org_1', kind: 'ai_call', amount: 200 });
    await recordUsage(ctx, { orgId: 'org_1', kind: 'ai_call', amount: 300 });
    await recordUsage(ctx, { orgId: 'org_1', kind: 'emulator_started', amount: 1 });
    // Another org's rows must not leak into org_1's totals.
    await recordUsage(ctx, { orgId: 'org_2', kind: 'ai_call', amount: 999 });

    const app = await build(store, 'org_1');
    const res = await app.inject({ method: 'GET', url: '/v1/usage' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      totals: Array<{ kind: string; total: number }>;
    };
    const map = new Map(body.totals.map((t) => [t.kind, t.total]));
    expect(map.get('ai_call')).toBe(500);
    expect(map.get('emulator_started')).toBe(1);
  });

  it('GET /v1/usage/events lists newest-first, org-scoped', async () => {
    const store: Store = { rows: [], filter: () => true };
    const ctx = makeCtx(store);
    await recordUsage(ctx, { orgId: 'org_1', kind: 'ai_call', amount: 1 });
    await recordUsage(ctx, { orgId: 'org_2', kind: 'ai_call', amount: 1 });
    await recordUsage(ctx, { orgId: 'org_1', kind: 'ai_call', amount: 2 });

    const app = await build(store, 'org_1');
    const res = await app.inject({ method: 'GET', url: '/v1/usage/events' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: UsageRow[] };
    expect(body.data).toHaveLength(2);
    for (const row of body.data) expect(row.orgId).toBe('org_1');
  });

  it('records an ingest usage event on successful sync ingest via app.inject', async () => {
    const store: Store = { rows: [], filter: () => true };
    // The ingest route selects a project row for AI-quality persistence — we
    // don't exercise that branch here (no judge), but the select() chain must
    // still resolve. Wrap makeDb to also handle .from(projects).limit(1).
    const baseDb = makeDb(store) as unknown as {
      insert: AppContext['db']['insert'];
      select: unknown;
    };
    const db = {
      ...baseDb,
      select: (cols?: unknown) => {
        // If it looks like the usage-aggregate select (with {kind,total}) or
        // the events listing select, delegate to the store-aware chain.
        if (cols && typeof cols === 'object' && 'total' in (cols as object)) {
          return (baseDb.select as (c?: unknown) => unknown)(cols);
        }
        // Otherwise it's the project lookup done by resolveProjectAccess /
        // ingest's AI-quality branch — return a single fake project row.
        const chain: any = {
          from: () => chain,
          where: () => chain,
          limit: async () => [{ id: 'proj_1', orgId: 'org_1', slug: 'acme' }],
        };
        return chain;
      },
    } as unknown as AppContext['db'];

    const ctx: AppContext = {
      logger: NoopLogger,
      db,
      storage: new MemoryStorage(),
      ingestion: {
        ingest: vi.fn(async () => ({
          irId: 'ir_1',
          graphId: 'g_1',
          ir: { api: { title: 'Acme' }, endpoints: [], resources: [] },
          warnings: [],
        })),
      } as unknown as AppContext['ingestion'],
      emulators: {} as AppContext['emulators'],
    };

    const app = Fastify();
    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof ZodError) {
        reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', message: err.message } });
        return;
      }
      if (isCarbonError(err)) {
        reply.status(500).send({ error: { code: err.code, message: err.message } });
        return;
      }
      reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
    });
    app.addHook('onRequest', async (req) => {
      (req as AuthenticatedRequest).apiKey = {
        id: 'k',
        orgId: 'org_1',
        prefix: 'aa11bb22cc33',
        scopes: ['read', 'write'],
        projectIds: null,
        expiresAt: null,
      };
      store.filter = (r) => r.orgId === 'org_1';
    });
    await registerIngestRoutes(app, ctx);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/ingest',
      payload: {
        projectSlug: 'acme',
        source: { kind: 'json', content: { openapi: '3.0.0' } },
        origin: 'unit-test',
        enrich: false,
      },
    });
    expect(res.statusCode).toBe(201);
    const ingestRows = store.rows.filter((r) => r.kind === 'ingest');
    expect(ingestRows).toHaveLength(1);
    expect(ingestRows[0]!.orgId).toBe('org_1');
    expect(ingestRows[0]!.amount).toBe(1);
  });

  it('threads orgId through the ingestion pipeline into the AI provider usage callback', async () => {
    // Fake provider records the last request it saw and fires onUsage with
    // whatever context was threaded through.
    let seenContext: CompletionRequest['context'];
    const captured: UsageEvent[] = [];
    const provider: AiProvider = {
      name: 'fake',
      defaultModel: 'fake-1',
      async complete(req: CompletionRequest): Promise<CompletionResponse> {
        seenContext = req.context;
        const evt: UsageEvent = {
          provider: 'fake',
          model: 'fake-1',
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          latencyMs: 1,
          context: req.context,
        };
        captured.push(evt);
        return { text: '{}', model: 'fake-1', usage: evt.usage };
      },
      async structured<T>(req: StructuredRequest<T>): Promise<T> {
        seenContext = req.context;
        const evt: UsageEvent = {
          provider: 'fake',
          model: 'fake-1',
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          latencyMs: 1,
          context: req.context,
        };
        captured.push(evt);
        // Return empty arrays that satisfy inferResources / inferRelationships.
        return req.schema.parse({ resources: [], relationships: [] } as unknown) as T;
      },
    };

    const store: Store = { rows: [], filter: () => true };
    const ctxForUsage = makeCtx(store);
    // Wire the provider's onUsage-like emission by mirroring the AppContext
    // callback: on each captured event, record usage using evt.context.orgId
    // (the exact code path apps/api/src/index.ts takes).
    const ai = new AiCapabilities(provider);
    const judge = new AiJudge({ provider, threshold: 0.5 });
    const parsers = new ParserRegistry().register(new OpenApiParser());
    const pipeline = createIngestionPipeline({
      parsers,
      storage: new MemoryStorage(),
      logger: NoopLogger,
      ai,
      judge,
    });

    await pipeline.ingest({
      projectSlug: 'acme',
      input: {
        kind: 'json',
        content: { openapi: '3.0.0', info: { title: 'x', version: '1' }, paths: {} },
        hint: 'openapi',
      },
      origin: 'test',
      enrich: true,
      context: { orgId: 'org_42', projectId: 'proj_42' },
    });

    // Every provider call threaded the same attribution context through.
    expect(seenContext).toEqual({ orgId: 'org_42', projectId: 'proj_42' });
    expect(captured.length).toBeGreaterThan(0);
    for (const evt of captured) {
      expect(evt.context?.orgId).toBe('org_42');
    }

    // Now play the onUsage-style side effect and assert a usage_events row
    // lands with orgId + kind='ai_call'.
    for (const evt of captured) {
      const orgId = evt.context?.orgId;
      if (!orgId) continue;
      await recordUsage(ctxForUsage, {
        orgId,
        kind: 'ai_call',
        amount: evt.usage.totalTokens || 1,
        metadata: { provider: evt.provider, model: evt.model },
      });
    }
    const aiRows = store.rows.filter((r) => r.kind === 'ai_call');
    expect(aiRows.length).toBe(captured.length);
    expect(aiRows.every((r) => r.orgId === 'org_42')).toBe(true);
  });

  it('requires admin scope', async () => {
    const store: Store = { rows: [], filter: () => true };
    const app = Fastify();
    app.setErrorHandler((err, _req, reply) => {
      if (isCarbonError(err) && err.code === 'CARBON_FORBIDDEN') {
        reply.status(403).send({ error: { code: err.code, message: err.message } });
        return;
      }
      reply.status(500).send({ error: String(err) });
    });
    app.addHook('onRequest', async (req) => {
      (req as AuthenticatedRequest).apiKey = {
        id: 'k',
        orgId: 'org_1',
        prefix: 'aa11bb22cc33',
        scopes: ['read'],
        projectIds: null,
        expiresAt: null,
      };
    });
    await registerUsageRoutes(app, makeCtx(store));
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/v1/usage' });
    expect(res.statusCode).toBe(403);
  });
});
