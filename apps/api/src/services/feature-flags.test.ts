import { beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@carbon/database';
import { NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { AppContext } from '../context.js';
import {
  BUILT_IN_FLAGS,
  _resetFeatureFlagCache,
  _resetSeededLatch,
  getFlag,
  listFlags,
  seedBuiltInFlags,
  setFlag,
} from './feature-flags.js';

/**
 * The service talks to Drizzle. We mock the Drizzle chain and inspect the
 * `where(...)` argument by walking it recursively to pull out every literal
 * string it references. That's precise enough for our filters because every
 * predicate here is `eq(col, 'literal')` — the constants (flag key, scope,
 * scope id) show up verbatim in the expression tree.
 */

interface FlagDefRow {
  id: string;
  key: string;
  description: string | null;
  defaultValue: boolean;
}
interface OverrideRow {
  id: string;
  flagKey: string;
  scope: 'org' | 'user' | 'plan';
  scopeId: string;
  value: boolean;
}

interface Store {
  defs: FlagDefRow[];
  overrides: OverrideRow[];
  overrideReads: number;
  defaultReads: number;
}

/** Recursively collect every string appearing in a Drizzle SQL expression. */
function collectStrings(x: unknown, out: Set<string> = new Set(), seen = new WeakSet()): Set<string> {
  if (x == null) return out;
  if (typeof x === 'string') {
    out.add(x);
    return out;
  }
  if (typeof x !== 'object') return out;
  if (seen.has(x as object)) return out;
  seen.add(x as object);
  if (Array.isArray(x)) {
    for (const v of x) collectStrings(v, out, seen);
    return out;
  }
  for (const k of Object.keys(x as Record<string, unknown>)) {
    collectStrings((x as Record<string, unknown>)[k], out, seen);
  }
  return out;
}

function makeCtx(store: Store): AppContext {
  const db = {
    select: () => {
      let table: unknown = null;
      let whereStrings: Set<string> | null = null;
      const chain: any = {
        from: (t: unknown) => {
          table = t;
          return chain;
        },
        where: (expr: unknown) => {
          whereStrings = collectStrings(expr);
          return chain;
        },
        limit: async () => {
          const strs = whereStrings ?? new Set<string>();
          if (table === schema.featureFlagOverrides) {
            store.overrideReads += 1;
            return store.overrides
              .filter(
                (o) =>
                  strs.has(o.flagKey) &&
                  strs.has(o.scope) &&
                  strs.has(o.scopeId),
              )
              .map((o) => ({ value: o.value }));
          }
          if (table === schema.featureFlags) {
            store.defaultReads += 1;
            return store.defs
              .filter((d) => strs.has(d.key))
              .map((d) => ({ defaultValue: d.defaultValue }));
          }
          return [];
        },
        then: (onF: any, onR: any) => {
          // `select().from(table)` (or with a whereless `where` in listFlags via
          // inArray) — return the whole store or the inArray-filtered view.
          if (table === schema.featureFlags) {
            return Promise.resolve(store.defs.map((d) => ({ ...d }))).then(onF, onR);
          }
          if (table === schema.featureFlagOverrides) {
            const strs = whereStrings;
            const rows = strs
              ? store.overrides.filter((o) => strs.has(o.flagKey))
              : store.overrides.slice();
            return Promise.resolve(rows.map((o) => ({ ...o }))).then(onF, onR);
          }
          return Promise.resolve([]).then(onF, onR);
        },
      };
      return chain;
    },
    insert: (table: unknown) => ({
      values: async (v: any) => {
        if (table === schema.featureFlags) {
          const rows = Array.isArray(v) ? v : [v];
          for (const r of rows) {
            store.defs.push({
              id: r.id,
              key: r.key,
              description: r.description ?? null,
              defaultValue: !!r.defaultValue,
            });
          }
        } else if (table === schema.featureFlagOverrides) {
          store.overrides.push({
            id: v.id,
            flagKey: v.flagKey,
            scope: v.scope,
            scopeId: v.scopeId,
            value: !!v.value,
          });
        }
      },
    }),
    delete: (table: unknown) => {
      let whereStrings: Set<string> | null = null;
      const del: any = {
        where: (expr?: unknown) => {
          whereStrings = expr ? collectStrings(expr) : null;
          return del.exec();
        },
        exec: async () => {
          if (table === schema.featureFlagOverrides && whereStrings) {
            const strs = whereStrings;
            store.overrides = store.overrides.filter(
              (o) => !(strs.has(o.flagKey) && strs.has(o.scope) && strs.has(o.scopeId)),
            );
          }
        },
      };
      // support both `.where(...)` (returns awaitable directly) and the
      // callsite pattern used in the service (which awaits the chain).
      return {
        where: async (expr?: unknown) => {
          whereStrings = expr ? collectStrings(expr) : null;
          if (table === schema.featureFlagOverrides && whereStrings) {
            const strs = whereStrings;
            store.overrides = store.overrides.filter(
              (o) => !(strs.has(o.flagKey) && strs.has(o.scope) && strs.has(o.scopeId)),
            );
          }
        },
      };
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

function fresh(): Store {
  _resetFeatureFlagCache();
  _resetSeededLatch();
  return { defs: [], overrides: [], overrideReads: 0, defaultReads: 0 };
}

describe('feature-flags service', () => {
  beforeEach(() => {
    _resetFeatureFlagCache();
    _resetSeededLatch();
  });

  it('seedBuiltInFlags inserts every built-in flag exactly once', async () => {
    const store = fresh();
    const ctx = makeCtx(store);
    await seedBuiltInFlags(ctx);
    expect(store.defs.length).toBe(BUILT_IN_FLAGS.length);
    _resetSeededLatch();
    await seedBuiltInFlags(ctx);
    expect(store.defs.length).toBe(BUILT_IN_FLAGS.length);
  });

  it('resolution order: user > org > plan > default', async () => {
    const store = fresh();
    store.defs.push({
      id: 'd1',
      key: 'x.enabled',
      description: null,
      defaultValue: false,
    });
    const ctx = makeCtx(store);

    expect(
      await getFlag(ctx, 'x.enabled', { orgId: 'o1', userId: 'u1', plan: 'team' }),
    ).toBe(false);

    await setFlag(ctx, 'x.enabled', 'plan', 'team', true);
    _resetFeatureFlagCache();
    expect(
      await getFlag(ctx, 'x.enabled', { orgId: 'o1', userId: 'u1', plan: 'team' }),
    ).toBe(true);

    await setFlag(ctx, 'x.enabled', 'org', 'o1', false);
    _resetFeatureFlagCache();
    expect(
      await getFlag(ctx, 'x.enabled', { orgId: 'o1', userId: 'u1', plan: 'team' }),
    ).toBe(false);

    await setFlag(ctx, 'x.enabled', 'user', 'u1', true);
    _resetFeatureFlagCache();
    expect(
      await getFlag(ctx, 'x.enabled', { orgId: 'o1', userId: 'u1', plan: 'team' }),
    ).toBe(true);
  });

  it('unknown flag resolves to false', async () => {
    const store = fresh();
    const ctx = makeCtx(store);
    expect(await getFlag(ctx, 'nope', { orgId: 'o1' })).toBe(false);
  });

  it('memoises reads within the 60s TTL', async () => {
    const store = fresh();
    store.defs.push({
      id: 'd2',
      key: 'cache.me',
      description: null,
      defaultValue: true,
    });
    const ctx = makeCtx(store);
    await getFlag(ctx, 'cache.me', { orgId: 'o1' });
    const firstReads = store.overrideReads + store.defaultReads;
    await getFlag(ctx, 'cache.me', { orgId: 'o1' });
    await getFlag(ctx, 'cache.me', { orgId: 'o1' });
    const laterReads = store.overrideReads + store.defaultReads;
    expect(laterReads).toBe(firstReads);
  });

  it('listFlags returns the org effective value for each flag', async () => {
    const store = fresh();
    store.defs.push(
      { id: 'a', key: 'a.on', description: null, defaultValue: true },
      { id: 'b', key: 'b.off', description: null, defaultValue: false },
    );
    store.overrides.push({
      id: 'ov1',
      flagKey: 'b.off',
      scope: 'org',
      scopeId: 'orgA',
      value: true,
    });
    const ctx = makeCtx(store);
    const rows = await listFlags(ctx, { orgId: 'orgA' });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey['a.on']!.effective).toBe(true);
    expect(byKey['b.off']!.effective).toBe(true);
    expect(byKey['b.off']!.overrides).toHaveLength(1);
    expect(byKey['b.off']!.overrides[0]).toMatchObject({
      scope: 'org',
      scopeId: 'orgA',
      value: true,
    });
  });
});
