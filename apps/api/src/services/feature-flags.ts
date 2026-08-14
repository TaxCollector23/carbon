import { and, eq, inArray } from 'drizzle-orm';
import { makeId } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { PlanTier } from './billing.js';

/**
 * Feature-flag resolution.
 *
 * Every flag has a global definition (`feature_flags`) plus zero or more
 * per-scope overrides (`feature_flag_overrides`). Resolution is:
 *
 *   user override → org override → plan override → flag default → false
 *
 * The most specific known override wins. `false` is the safe fallback so a
 * caller that types a flag key we have never seen before does not silently
 * enable a code path.
 */

export type FlagScope = 'user' | 'org' | 'plan';

export interface FlagResolutionContext {
  readonly orgId?: string | null;
  readonly userId?: string | null;
  readonly plan?: PlanTier | null;
}

export interface FeatureFlagDefinition {
  readonly key: string;
  readonly description: string | null;
  readonly defaultValue: boolean;
}

export interface FeatureFlagOverrideView {
  readonly scope: FlagScope;
  readonly scopeId: string;
  readonly value: boolean;
}

export interface ListedFeatureFlag extends FeatureFlagDefinition {
  readonly overrides: readonly FeatureFlagOverrideView[];
  /** Effective value for the caller's org (org override → plan → default). */
  readonly effective: boolean;
}

/**
 * Built-in flags that must exist even before an admin has explicitly
 * created any override. Seeded on first read of `/v1/feature-flags`.
 */
export const BUILT_IN_FLAGS: readonly FeatureFlagDefinition[] = [
  {
    key: 'dashboard.ai_quality_v2',
    description: 'Enable the redesigned AI-quality dashboard.',
    defaultValue: false,
  },
  {
    key: 'emulator.wasm_runtime_preview',
    description: 'Route new emulators to the experimental WASM runtime.',
    defaultValue: false,
  },
  {
    key: 'search.enabled',
    description: 'Show the global search palette in the dashboard.',
    defaultValue: true,
  },
  {
    key: 'cli.telemetry_v2',
    description: 'Report v2 telemetry events from the Carbon CLI.',
    defaultValue: false,
  },
];

// -----------------------------------------------------------------------------
// Cache — 60s TTL keyed by (flagKey, scope, scopeId). A single flag lookup
// for a request touches at most three keys (user + org + plan). The cache is
// process-local; a multi-node deploy tolerates 60s of lag on flip.
// -----------------------------------------------------------------------------

interface CacheEntry {
  readonly value: boolean | null;
  readonly expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

function cacheKey(flagKey: string, scope: FlagScope | 'default', scopeId: string): string {
  return `${scope}:${scopeId}:${flagKey}`;
}

/** Exposed for tests. Not part of the public service surface. */
export function _resetFeatureFlagCache(): void {
  cache.clear();
}

async function readOverride(
  ctx: AppContext,
  flagKey: string,
  scope: FlagScope,
  scopeId: string,
): Promise<boolean | null> {
  const key = cacheKey(flagKey, scope, scopeId);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const [row] = await ctx.db
    .select({ value: schema.featureFlagOverrides.value })
    .from(schema.featureFlagOverrides)
    .where(
      and(
        eq(schema.featureFlagOverrides.flagKey, flagKey),
        eq(schema.featureFlagOverrides.scope, scope),
        eq(schema.featureFlagOverrides.scopeId, scopeId),
      ),
    )
    .limit(1);
  const value: boolean | null = row ? row.value : null;
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

async function readDefault(ctx: AppContext, flagKey: string): Promise<boolean | null> {
  const key = cacheKey(flagKey, 'default', 'global');
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const [row] = await ctx.db
    .select({ defaultValue: schema.featureFlags.defaultValue })
    .from(schema.featureFlags)
    .where(eq(schema.featureFlags.key, flagKey))
    .limit(1);
  const value: boolean | null = row ? row.defaultValue : null;
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

function invalidate(flagKey: string, scope: FlagScope, scopeId: string): void {
  cache.delete(cacheKey(flagKey, scope, scopeId));
}

/**
 * Return the effective value for `key` for the given resolution context.
 * User override wins over org, which wins over plan, which wins over the
 * flag default. An unknown flag resolves to `false`.
 */
export async function getFlag(
  ctx: AppContext,
  key: string,
  scope: FlagResolutionContext,
): Promise<boolean> {
  if (scope.userId) {
    const v = await readOverride(ctx, key, 'user', scope.userId);
    if (v !== null) return v;
  }
  if (scope.orgId) {
    const v = await readOverride(ctx, key, 'org', scope.orgId);
    if (v !== null) return v;
  }
  if (scope.plan) {
    const v = await readOverride(ctx, key, 'plan', scope.plan);
    if (v !== null) return v;
  }
  const dflt = await readDefault(ctx, key);
  return dflt ?? false;
}

/**
 * Upsert an override. The unique index on `(flag_key, scope, scope_id)`
 * makes this a natural upsert; we implement it as delete + insert to keep
 * the query surface small and avoid dialect-specific ON CONFLICT wiring.
 */
export async function setFlag(
  ctx: AppContext,
  flagKey: string,
  scope: FlagScope,
  scopeId: string,
  value: boolean,
): Promise<FeatureFlagOverrideView> {
  await ctx.db
    .delete(schema.featureFlagOverrides)
    .where(
      and(
        eq(schema.featureFlagOverrides.flagKey, flagKey),
        eq(schema.featureFlagOverrides.scope, scope),
        eq(schema.featureFlagOverrides.scopeId, scopeId),
      ),
    );
  await ctx.db.insert(schema.featureFlagOverrides).values({
    id: makeId('ff'),
    flagKey,
    scope,
    scopeId,
    value,
  });
  invalidate(flagKey, scope, scopeId);
  return { scope, scopeId, value };
}

/**
 * List every flag definition, joined with any overrides that apply to the
 * caller's org or plan (and, when known, the caller themselves). The
 * `effective` field is the org-level resolved value so a dashboard row can
 * be rendered without a second round-trip per flag.
 */
export async function listFlags(
  ctx: AppContext,
  scope: FlagResolutionContext,
): Promise<ListedFeatureFlag[]> {
  const defs = await ctx.db
    .select({
      key: schema.featureFlags.key,
      description: schema.featureFlags.description,
      defaultValue: schema.featureFlags.defaultValue,
    })
    .from(schema.featureFlags);
  if (defs.length === 0) return [];

  const relevantIds: Array<{ scope: FlagScope; id: string }> = [];
  if (scope.orgId) relevantIds.push({ scope: 'org', id: scope.orgId });
  if (scope.userId) relevantIds.push({ scope: 'user', id: scope.userId });
  if (scope.plan) relevantIds.push({ scope: 'plan', id: scope.plan });

  const flagKeys = defs.map((d) => d.key);
  const overrideRows = await ctx.db
    .select({
      flagKey: schema.featureFlagOverrides.flagKey,
      scope: schema.featureFlagOverrides.scope,
      scopeId: schema.featureFlagOverrides.scopeId,
      value: schema.featureFlagOverrides.value,
    })
    .from(schema.featureFlagOverrides)
    .where(inArray(schema.featureFlagOverrides.flagKey, flagKeys));

  const byFlag = new Map<string, FeatureFlagOverrideView[]>();
  for (const row of overrideRows) {
    if (!relevantIds.some((r) => r.scope === row.scope && r.id === row.scopeId)) continue;
    const list = byFlag.get(row.flagKey) ?? [];
    list.push({
      scope: row.scope as FlagScope,
      scopeId: row.scopeId,
      value: row.value,
    });
    byFlag.set(row.flagKey, list);
  }

  return defs.map((d) => {
    const overrides = byFlag.get(d.key) ?? [];
    const effective = pickEffective(overrides, scope, d.defaultValue);
    return {
      key: d.key,
      description: d.description,
      defaultValue: d.defaultValue,
      overrides,
      effective,
    };
  });
}

function pickEffective(
  overrides: readonly FeatureFlagOverrideView[],
  scope: FlagResolutionContext,
  defaultValue: boolean,
): boolean {
  const byPriority: FlagScope[] = ['user', 'org', 'plan'];
  for (const s of byPriority) {
    const id = s === 'user' ? scope.userId : s === 'org' ? scope.orgId : (scope.plan ?? undefined);
    if (!id) continue;
    const match = overrides.find((o) => o.scope === s && o.scopeId === id);
    if (match) return match.value;
  }
  return defaultValue;
}

// -----------------------------------------------------------------------------
// Bootstrap
// -----------------------------------------------------------------------------

let seededOnce = false;

/**
 * Ensure every built-in flag has a row in `feature_flags`. Idempotent — a
 * repeat call is a no-op if every key is already present. Callable from an
 * app-startup hook or lazily on first read of `/v1/feature-flags`.
 */
export async function seedBuiltInFlags(ctx: AppContext): Promise<void> {
  if (seededOnce) return;
  const existing = await ctx.db.select({ key: schema.featureFlags.key }).from(schema.featureFlags);
  const have = new Set(existing.map((r) => r.key));
  const missing = BUILT_IN_FLAGS.filter((f) => !have.has(f.key));
  if (missing.length > 0) {
    await ctx.db.insert(schema.featureFlags).values(
      missing.map((f) => ({
        id: makeId('ffdef'),
        key: f.key,
        description: f.description,
        defaultValue: f.defaultValue,
      })),
    );
  }
  seededOnce = true;
}

/** Reset for tests — clears the memoised "seeded" latch. */
export function _resetSeededLatch(): void {
  seededOnce = false;
}
