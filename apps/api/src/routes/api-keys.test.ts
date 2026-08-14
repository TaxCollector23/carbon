import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { registerApiKeyAuth } from '../plugins/api-key.js';
import { mintApiKey, rotateApiKey } from '../services/api-keys.js';
import type { AppContext } from '../context.js';

/**
 * These tests focus on the rotation-with-grace + short-lived-key surface.
 *
 * The auth plugin is exercised via a tiny in-memory shim that stands in for
 * the `apiKeys` table — enough for select/insert/update/transaction. That
 * lets `rotateApiKey` and the auth hook read the same rows without pulling
 * in Postgres, and we drive time with an injectable `now()` rather than
 * sleeping.
 */

interface KeyRow {
  id: string;
  orgId: string;
  name: string;
  hash: string;
  prefix: string;
  scopes: string[];
  projectIds: string[] | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
  rotatedFromId: string | null;
}

interface Store {
  rows: KeyRow[];
  now: () => Date;
}

/**
 * Build a Drizzle-shaped client whose chains inspect `store.rows`. The auth
 * plugin's SELECT filters by prefix + `revokedAt IS NULL` + `expires_at IS NULL
 * OR expires_at > now()`; we replay that filter in JS against the store so the
 * SQL guard and the app-side guard both fire in tests.
 */
function makeDb(store: Store): AppContext['db'] {
  const selectFrom = () => {
    let filter: (r: KeyRow) => boolean = () => true;
    const chain = {
      from: () => chain,
      where: (predicate?: unknown) => {
        // We can't introspect the drizzle SQL AST cheaply; instead every call
        // site sets a matching filter by discipline through the wrapper below.
        void predicate;
        return chain;
      },
      limit: async (_n: number) => store.rows.filter(filter),
    };
    // Expose a way to set the filter from the outer wrapper.
    (chain as unknown as { setFilter: (f: typeof filter) => void }).setFilter = (f) => {
      filter = f;
    };
    return chain;
  };

  // Wrap `select()` so callers can hint at the filter they want applied. The
  // auth plugin calls select().from().where(prefix+notRevoked+notExpired).limit(1);
  // the rotate service calls select().from().where(id+org).limit(1). We
  // key the filter off the caller by inspecting `store.__selectMode`.
  const db = {
    select: (..._args: unknown[]) => {
      const chain = selectFrom();
      // Read the currently requested mode from the store; each caller sets it
      // just before invoking select().
      const setFilter = (chain as unknown as { setFilter: (f: (r: KeyRow) => boolean) => void })
        .setFilter;
      const mode = (store as unknown as { __mode?: SelectMode }).__mode ?? {
        kind: 'auth',
        prefix: '',
        nowMs: store.now().getTime(),
      };
      if (mode.kind === 'auth') {
        // Intentionally do NOT filter by expiresAt here so the plugin's
        // app-side belt-and-suspenders check gets to fire and surface the
        // 'API key expired' message. The real SQL guard covers the DB-side
        // case; this exercises the code path that runs when the two clocks
        // disagree.
        setFilter((r) => r.prefix === mode.prefix && r.revokedAt === null);
      } else if (mode.kind === 'byIdOrg') {
        setFilter((r) => r.id === mode.id && r.orgId === mode.orgId);
      } else if (mode.kind === 'byId') {
        setFilter((r) => r.id === mode.id);
      }
      return chain;
    },
    insert: (_table: unknown) => ({
      values: async (v: Partial<KeyRow>) => {
        store.rows.push({
          id: v.id!,
          orgId: v.orgId!,
          name: v.name!,
          hash: v.hash!,
          prefix: v.prefix!,
          scopes: v.scopes ?? ['admin'],
          projectIds: (v.projectIds as string[] | null | undefined) ?? null,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: new Date(),
          expiresAt: (v.expiresAt as Date | null | undefined) ?? null,
          rotatedFromId: (v.rotatedFromId as string | null | undefined) ?? null,
        });
      },
    }),
    update: (_table: unknown) => {
      let patch: Partial<KeyRow> = {};
      let filter: (r: KeyRow) => boolean = () => true;
      let applied = false;
      const applyOnce = (): KeyRow[] => {
        if (applied) return [];
        applied = true;
        const affected: KeyRow[] = [];
        for (const r of store.rows) {
          if (filter(r)) {
            Object.assign(r, patch);
            affected.push(r);
          }
        }
        return affected;
      };
      const chain: {
        set: (p: Partial<KeyRow>) => typeof chain;
        where: (_p?: unknown) => typeof chain & PromiseLike<unknown>;
        returning: (_cols?: unknown) => Promise<KeyRow[]>;
      } = {
        set: (p) => {
          patch = p;
          return chain;
        },
        where: (_p?: unknown) => {
          const mode = (store as unknown as { __updateMode?: UpdateMode }).__updateMode ?? {
            kind: 'byId',
            id: '',
          };
          if (mode.kind === 'rotateExpire') {
            filter = (r) => r.id === mode.id && r.revokedAt === null;
          } else {
            filter = (r) => r.id === mode.id;
          }
          // Awaiting `.where()` executes the mutation (the auth plugin's
          // fire-and-forget lastUsedAt touch). If `.returning()` is chained
          // instead, the mutation is deferred to that call.
          const p = Promise.resolve().then(() => applyOnce());
          return Object.assign(chain, { then: p.then.bind(p) });
        },
        returning: async () => applyOnce(),
      };
      return chain;
    },
    transaction: async <T>(fn: (tx: AppContext['db']) => Promise<T>): Promise<T> =>
      fn(db as AppContext['db']),
  } as unknown as AppContext['db'];
  return db;
}

type SelectMode =
  | { kind: 'auth'; prefix: string; nowMs: number }
  | { kind: 'byIdOrg'; id: string; orgId: string }
  | { kind: 'byId'; id: string };
type UpdateMode = { kind: 'rotateExpire'; id: string } | { kind: 'byId'; id: string };

function makeCtx(store: Store): AppContext {
  return {
    logger: NoopLogger,
    db: makeDb(store),
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

async function buildAuthApp(store: Store): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (isCarbonError(err)) {
      const status = err.code === 'CARBON_UNAUTHENTICATED' ? 401 : 500;
      reply.status(status).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
  });
  // The auth plugin issues one select() per request. We swap __mode to the
  // auth filter right before it runs.
  const ctx = makeCtx(store);
  app.addHook('onRequest', async (req) => {
    const raw = req.headers['x-carbon-key'];
    const presented = Array.isArray(raw) ? raw[0] : raw;
    const prefix =
      typeof presented === 'string' ? (presented.split('.')[0]?.replace('ck_live_', '') ?? '') : '';
    (store as unknown as { __mode: SelectMode }).__mode = {
      kind: 'auth',
      prefix,
      nowMs: store.now().getTime(),
    };
    (store as unknown as { __updateMode: UpdateMode }).__updateMode = { kind: 'byId', id: '' };
  });
  await registerApiKeyAuth(app, ctx, { mode: 'enforced' });
  app.get('/v1/ping', async () => ({ ok: true }));
  return app;
}

function hashOf(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

describe('api key rotation + short-lived keys', () => {
  it('rotate mints a successor and sets the source expiresAt to now + grace', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const store: Store = {
      rows: [
        {
          id: 'key_src',
          orgId: 'org_1',
          name: 'prod',
          hash: hashOf('secret-fixture-value-32-chars-ok'),
          prefix: 'aa11bb22cc33',
          scopes: ['admin'],
          projectIds: null,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: new Date('2025-12-01T00:00:00Z'),
          expiresAt: null,
          rotatedFromId: null,
        },
      ],
      now: () => now,
    };
    (store as unknown as { __mode: SelectMode }).__mode = {
      kind: 'byIdOrg',
      id: 'key_src',
      orgId: 'org_1',
    };
    (store as unknown as { __updateMode: UpdateMode }).__updateMode = {
      kind: 'rotateExpire',
      id: 'key_src',
    };
    const ctx = makeCtx(store);
    const result = await rotateApiKey(ctx, {
      sourceId: 'key_src',
      orgId: 'org_1',
      graceSeconds: 3600,
      now: () => now,
    });

    expect(result.minted.presented).toMatch(/^ck_live_[a-f0-9]{12}\./);
    expect(result.minted.rotatedFromId).toBe('key_src');
    expect(result.source.id).toBe('key_src');
    expect(result.source.expiresAt.getTime()).toBe(now.getTime() + 3600 * 1000);

    const source = store.rows.find((r) => r.id === 'key_src')!;
    expect(source.expiresAt?.getTime()).toBe(now.getTime() + 3600 * 1000);
    expect(source.revokedAt).toBeNull();
    const minted = store.rows.find((r) => r.id === result.minted.id)!;
    expect(minted.name).toBe('prod (rotated)');
    expect(minted.rotatedFromId).toBe('key_src');
  });

  it('both keys authenticate during the grace window; source is rejected after', async () => {
    // Use real Date.now() as the base so the plugin's app-side
    // `row.expiresAt <= Date.now()` check sees the same clock the test moves.
    let clock = Date.now();
    const store: Store = {
      rows: [
        {
          id: 'key_src',
          orgId: 'org_1',
          name: 'prod',
          hash: hashOf('secret-fixture-value-32-chars-ok'),
          prefix: 'aa11bb22cc33',
          scopes: ['admin'],
          projectIds: null,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: new Date(clock),
          expiresAt: null,
          rotatedFromId: null,
        },
      ],
      now: () => new Date(clock),
    };
    // Rotate.
    (store as unknown as { __mode: SelectMode }).__mode = {
      kind: 'byIdOrg',
      id: 'key_src',
      orgId: 'org_1',
    };
    (store as unknown as { __updateMode: UpdateMode }).__updateMode = {
      kind: 'rotateExpire',
      id: 'key_src',
    };
    const ctx = makeCtx(store);
    const rotated = await rotateApiKey(ctx, {
      sourceId: 'key_src',
      orgId: 'org_1',
      graceSeconds: 60,
      now: () => new Date(clock),
    });
    // Rewrite the newly-minted key's hash to a known secret so we can present
    // it in an HTTP call. Also fix its prefix so we can address it.
    const mintedRow = store.rows.find((r) => r.id === rotated.minted.id)!;
    mintedRow.hash = hashOf('secret-fixture-value-32-chars-ok');
    mintedRow.prefix = 'ff88ee77dd66';

    const app = await buildAuthApp(store);
    const sourceHeader = `ck_live_aa11bb22cc33.secret-fixture-value-32-chars-ok`;
    const newHeader = `ck_live_ff88ee77dd66.secret-fixture-value-32-chars-ok`;

    // Within grace: both authenticate.
    let res = await app.inject({
      method: 'GET',
      url: '/v1/ping',
      headers: { 'x-carbon-key': sourceHeader },
    });
    expect(res.statusCode).toBe(200);
    res = await app.inject({
      method: 'GET',
      url: '/v1/ping',
      headers: { 'x-carbon-key': newHeader },
    });
    expect(res.statusCode).toBe(200);

    // Advance past grace by rewriting the source's expiresAt to the past —
    // we don't wall-clock sleep in tests.
    const sourceRow = store.rows.find((r) => r.id === 'key_src')!;
    sourceRow.expiresAt = new Date(Date.now() - 1_000);
    res = await app.inject({
      method: 'GET',
      url: '/v1/ping',
      headers: { 'x-carbon-key': sourceHeader },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { message: string; details?: { expiredAt?: string } } };
    expect(body.error.message).toBe('API key expired');
    expect(body.error.details?.expiredAt).toBeTruthy();

    res = await app.inject({
      method: 'GET',
      url: '/v1/ping',
      headers: { 'x-carbon-key': newHeader },
    });
    expect(res.statusCode).toBe(200);
  });

  it('short-lived key: mintApiKey with expiresAt is rejected past its lifetime', async () => {
    // Use real Date.now() as the base so the plugin's app-side
    // `row.expiresAt <= Date.now()` check sees the same clock the test moves.
    const store: Store = { rows: [], now: () => new Date() };
    const ctx = makeCtx(store);
    const minted = await mintApiKey(ctx, {
      orgId: 'org_1',
      name: 'ci-short',
      expiresAt: new Date(Date.now() + 60_000),
    });
    // Fix the hash to a known secret so we can present it.
    const row = store.rows.find((r) => r.id === minted.id)!;
    row.hash = hashOf('secret-fixture-value-32-chars-ok');
    row.prefix = 'cccc1111dddd';

    const app = await buildAuthApp(store);
    const header = `ck_live_cccc1111dddd.secret-fixture-value-32-chars-ok`;

    let res = await app.inject({
      method: 'GET',
      url: '/v1/ping',
      headers: { 'x-carbon-key': header },
    });
    expect(res.statusCode).toBe(200);

    // Move the key's expiration to the past — no wall-clock sleep required.
    row.expiresAt = new Date(Date.now() - 1_000);
    res = await app.inject({ method: 'GET', url: '/v1/ping', headers: { 'x-carbon-key': header } });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { message: string } };
    expect(body.error.message).toBe('API key expired');
  });
});
