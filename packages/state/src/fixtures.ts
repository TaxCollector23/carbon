import type { ResourceId } from '@carbon/types';
import type { StateEngine } from './engine.js';

/**
 * A map of resource id → rows to seed. Row objects are inserted verbatim via
 * `engine.create` so any `id` present is preserved and any that is missing is
 * minted deterministically by the engine.
 */
export type FixtureMap = Readonly<Record<string, ReadonlyArray<Readonly<Record<string, unknown>>>>>;

/**
 * Seed an engine from a fixtures map. Callers typically wire this to
 * `runtime.reset()` so tests always begin from the same baseline.
 */
export async function loadFixtures(engine: StateEngine, fixtures: FixtureMap): Promise<void> {
  for (const [resource, rows] of Object.entries(fixtures)) {
    for (const row of rows) {
      await engine.create(resource as ResourceId, row);
    }
  }
}
