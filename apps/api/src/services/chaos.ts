import { and, eq } from 'drizzle-orm';
import { makeId } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';

/**
 * Rules stored under `chaos_presets.rules`. Interpreted by the runtime chaos
 * plugins (error-injection.ts, latency.ts). The API layer never inspects the
 * inside of a rule — it just streams them through to the emulator registry.
 */
export interface ChaosRule {
  readonly kind: 'error' | 'latency';
  readonly match?: { readonly method?: string; readonly path?: string };
  readonly probability?: number;
  readonly status?: number;
  readonly body?: unknown;
  readonly floorMs?: number;
  readonly jitterMs?: number;
}

interface BuiltInSpec {
  readonly name: string;
  readonly description: string;
  readonly rules: readonly ChaosRule[];
}

/**
 * Curated presets seeded into every new org. `name` is the org-scoped unique
 * key — adding a new built-in later is safe (upsert-on-conflict semantics
 * would still leave earlier orgs without it; run a migration if you need to
 * back-fill).
 */
export const BUILT_IN_CHAOS_PRESETS: readonly BuiltInSpec[] = [
  {
    name: 'flaky-network',
    description: '10% error rate with 200-500ms of random latency on every request.',
    rules: [
      {
        kind: 'error',
        match: { path: '/*' },
        probability: 0.1,
        status: 502,
      },
      { kind: 'latency', floorMs: 200, jitterMs: 300 },
    ],
  },
  {
    name: 'slow-third-party',
    description: 'Simulate a slow external dependency by adding 2s of latency.',
    rules: [{ kind: 'latency', floorMs: 2000, jitterMs: 0 }],
  },
  {
    name: 'third-party-outage',
    description: 'Return 503 on every external-shaped URL.',
    rules: [
      {
        kind: 'error',
        match: { path: '/*' },
        probability: 1,
        status: 503,
        body: { error: { code: 'CARBON_INJECTED', message: 'third-party outage' } },
      },
    ],
  },
];

/**
 * Idempotent — safe to call on API boot and from any org-creation flow. Skips
 * presets whose (orgId, name) row already exists.
 */
export async function seedBuiltInPresets(ctx: AppContext, orgId: string): Promise<number> {
  let inserted = 0;
  for (const spec of BUILT_IN_CHAOS_PRESETS) {
    const [existing] = await ctx.db
      .select({ id: schema.chaosPresets.id })
      .from(schema.chaosPresets)
      .where(and(eq(schema.chaosPresets.orgId, orgId), eq(schema.chaosPresets.name, spec.name)))
      .limit(1);
    if (existing) continue;
    await ctx.db.insert(schema.chaosPresets).values({
      id: makeId('chaos'),
      orgId,
      name: spec.name,
      description: spec.description,
      rules: spec.rules,
      builtIn: true,
    });
    inserted += 1;
  }
  return inserted;
}

/**
 * Translate a stored `ChaosRule[]` into the plugin-shaped `errorRules` and
 * `latency` config the emulator registry expects. Kept in the service so the
 * route handler is the same whether presets or ad-hoc rules are applied.
 */
export function compileRules(rules: readonly ChaosRule[]): {
  errorRules: {
    match: { method?: string; path: string };
    probability: number;
    action: { kind: 'status'; status: number; body?: unknown };
  }[];
  latency: { floorMs?: number; jitterMs?: number };
} {
  const errorRules: {
    match: { method?: string; path: string };
    probability: number;
    action: { kind: 'status'; status: number; body?: unknown };
  }[] = [];
  let floorMs = 0;
  let jitterMs = 0;
  for (const rule of rules) {
    if (rule.kind === 'error') {
      errorRules.push({
        match: { method: rule.match?.method, path: rule.match?.path ?? '/*' },
        probability: rule.probability ?? 1,
        action: { kind: 'status', status: rule.status ?? 500, body: rule.body },
      });
    } else if (rule.kind === 'latency') {
      // Sum stacked latency rules — the operator's intent when they add two
      // is "layered slowness", not "one wins".
      floorMs += rule.floorMs ?? 0;
      jitterMs += rule.jitterMs ?? 0;
    }
  }
  return { errorRules, latency: { floorMs, jitterMs } };
}
