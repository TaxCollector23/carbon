import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import { registerLeadsRoutes } from './leads.js';

/**
 * Marketing /contact form → POST /v1/leads. Public, unauthenticated,
 * rate-limited per IP. The db is stubbed with an in-memory sink so we can
 * assert rows were written without touching Postgres.
 */

interface LeadRow {
  id: string;
  email: string;
  name: string;
  company: string;
  seats: number | null;
  useCase: string | null;
  source: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

function makeDb(sink: LeadRow[]): AppContext['db'] {
  return {
    insert: (table: unknown) => ({
      values: async (v: LeadRow) => {
        if (table === schema.leads) sink.push({ ...v });
      },
    }),
  } as unknown as AppContext['db'];
}

function makeCtx(sink: LeadRow[]): AppContext {
  return {
    logger: NoopLogger,
    db: makeDb(sink),
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

async function buildApp(): Promise<{
  app: FastifyInstance;
  sink: LeadRow[];
}> {
  const sink: LeadRow[] = [];
  const app = Fastify();
  // Mirror the server's zod error mapping so a schema failure surfaces as 400
  // instead of Fastify's default 500.
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', issues: err.issues } });
      return;
    }
    if (isCarbonError(err)) {
      const status = err.code === 'CARBON_RATE_LIMITED' ? 429 : 400;
      reply.status(status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    // Fastify tags its own validation / body-limit / malformed-JSON errors
    // with a 4xx `statusCode` — surface those as-is instead of a generic 500.
    const s = (err as { statusCode?: number }).statusCode;
    if (typeof s === 'number' && s >= 400 && s < 500) {
      const msg = err instanceof Error ? err.message : String(err);
      reply.status(s).send({ error: { code: 'CARBON_INVALID_INPUT', message: msg } });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: 'boom' } });
  });
  await registerLeadsRoutes(app, makeCtx(sink));
  return { app, sink };
}

describe('POST /v1/leads', () => {
  it('accepts a well-formed lead and stores it', async () => {
    const { app, sink } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/leads',
      payload: {
        name: 'Ada Lovelace',
        email: 'Ada@Example.com',
        company: 'Analytical Engines',
        seats: 25,
        useCase: 'We need SSO + audit export for a regulated workload.',
        source: 'marketing:/contact',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; createdAt: string };
    expect(body.id).toMatch(/^lead_[a-f0-9]{24}$/);
    expect(typeof body.createdAt).toBe('string');
    expect(sink).toHaveLength(1);
    // Emails are normalized to lowercase so dedup and CRM lookups behave.
    expect(sink[0]!.email).toBe('ada@example.com');
    expect(sink[0]!.company).toBe('Analytical Engines');
    expect(sink[0]!.seats).toBe(25);
    expect(sink[0]!.source).toBe('marketing:/contact');
  });

  it('rejects missing required fields with 400', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/leads',
      payload: { name: '', email: 'not-an-email', company: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rate-limits after 5 submissions from the same IP', async () => {
    const { app } = await buildApp();
    const payload = {
      name: 'Grace Hopper',
      email: 'grace@example.com',
      company: 'USN',
      seats: 3,
      useCase: 'testing',
    };
    for (let i = 0; i < 5; i += 1) {
      const ok = await app.inject({ method: 'POST', url: '/v1/leads', payload });
      expect(ok.statusCode).toBe(201);
    }
    const blocked = await app.inject({ method: 'POST', url: '/v1/leads', payload });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('trims and normalizes optional whitespace fields', async () => {
    const { app, sink } = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/v1/leads',
      payload: {
        name: '  Alan Turing  ',
        email: 'alan@example.com',
        company: '  Bletchley  ',
        seats: 12,
        useCase: '   we like carbon   ',
      },
    });
    expect(sink[0]!.name).toBe('Alan Turing');
    expect(sink[0]!.company).toBe('Bletchley');
    expect(sink[0]!.useCase).toBe('we like carbon');
  });
});
