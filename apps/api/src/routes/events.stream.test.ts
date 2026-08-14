import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { recordEvent } from '../services/events.js';
import { registerEventRoutes } from './events.js';

/**
 * The SSE route hands the raw socket to Fastify's underlying HTTP server, so
 * `app.inject` (which returns a light-weight mock) can't observe the streamed
 * frames. We spin the app on an ephemeral port and consume the stream with
 * `fetch`, then trigger `recordEvent` in-process and assert the client sees
 * `hello`, a `ping` (heartbeat interval shortened for the test), and the
 * subsequent `new-event` frame.
 */

// The stream route reads this env var to pick a heartbeat interval — shrink it
// so we don't wait 15s for a heartbeat.
process.env.CARBON_SSE_HEARTBEAT_MS = '40';

interface EventRow {
  id: string;
  orgId: string;
  projectId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  metadata: unknown;
  createdAt: Date;
}

function makeCtx(): AppContext {
  const rows: EventRow[] = [];
  const db = {
    insert: (_t: unknown) => ({
      values: async (v: Partial<EventRow>) => {
        rows.push({
          id: v.id!,
          orgId: v.orgId!,
          projectId: (v.projectId as string | null | undefined) ?? null,
          actorType: v.actorType!,
          actorId: (v.actorId as string | null | undefined) ?? null,
          action: v.action!,
          metadata: v.metadata ?? {},
          createdAt: new Date(),
        });
      },
    }),
    select: (_c?: unknown) => {
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: async () => rows.slice(),
      };
      return chain;
    },
  } as unknown as AppContext['db'];
  return {
    logger: NoopLogger,
    db,
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

async function build(
  orgId: string,
): Promise<{ app: FastifyInstance; url: string; ctx: AppContext }> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    (req as AuthenticatedRequest).apiKey = {
      id: 'key_test',
      orgId,
      prefix: 'aa11bb22cc33',
      scopes: ['read'],
      projectIds: null,
      expiresAt: null,
    };
  });
  const ctx = makeCtx();
  await registerEventRoutes(app, ctx);
  await app.ready();
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, url: address, ctx };
}

async function readFramesUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (buf: string) => boolean,
  timeoutMs = 2000,
): Promise<string> {
  const decoder = new TextDecoder();
  let acc = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const step = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), remaining),
      ),
    ]);
    if (step.done) break;
    acc += decoder.decode(step.value as Uint8Array, { stream: true });
    if (predicate(acc)) return acc;
  }
  return acc;
}

describe('events SSE stream', () => {
  let harness: { app: FastifyInstance; url: string; ctx: AppContext } | undefined;

  beforeAll(async () => {
    harness = await build('org_a');
  });

  afterEach(async () => {
    // Each test opens its own fetch; nothing to reset here yet.
  });

  it('streams hello + heartbeat + new-event to a live subscriber', async () => {
    if (!harness) throw new Error('no harness');
    const controller = new AbortController();
    const res = await fetch(`${harness.url}/v1/events/stream`, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const body = res.body;
    if (!body) throw new Error('no body');
    const reader = body.getReader();

    // Wait for the initial hello frame.
    const helloBuf = await readFramesUntil(reader, (b) => b.includes('event: hello'));
    expect(helloBuf).toContain('event: hello');
    expect(helloBuf).toMatch(/"connectionId":"[0-9a-f-]{36}"/);

    // Publish a new event; the subscriber should observe a new-event frame.
    // Do this before waiting for a heartbeat so the test doesn't have to hold
    // the socket open for a fresh 40ms tick after every read.
    await recordEvent(harness.ctx, {
      orgId: 'org_a',
      actorType: 'system',
      action: 'test.stream',
      metadata: { hello: 'world' },
    });

    const afterEvent = await readFramesUntil(
      reader,
      (b) => b.includes('event: new-event') && b.includes('event: ping'),
      2000,
    );
    expect(afterEvent).toContain('event: new-event');
    expect(afterEvent).toContain('"action":"test.stream"');
    expect(afterEvent).toContain('event: ping');

    // Cross-org publishes MUST NOT leak into this subscriber.
    await recordEvent(harness.ctx, {
      orgId: 'org_other',
      actorType: 'system',
      action: 'noise.should.not.appear',
    });
    // Give the emitter a tick; then confirm the frame is absent by draining a
    // short window.
    const tail = await readFramesUntil(reader, () => false, 120);
    expect(tail).not.toContain('noise.should.not.appear');

    controller.abort();
    try {
      await reader.cancel();
    } catch {
      // Aborted — expected.
    }
    await harness.app.close();
    harness = undefined;
  });
});
