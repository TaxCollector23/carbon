import type { RuntimePlugin } from '../runtime.js';

export interface LatencyProfile {
  /** Fixed floor delay in ms. Applied to every request. */
  readonly floorMs?: number;
  /** Random extra delay uniform in [0, jitterMs). */
  readonly jitterMs?: number;
  /**
   * Deterministic hash-based delay derived from `${method} ${url}`. Same
   * request → same delay across runs. Useful for reproducible tests.
   */
  readonly deterministic?: boolean;
}

/**
 * Simulate real-world API latency. The default profile is 0/0 — no delay —
 * so tests can opt in without global side-effects.
 */
export function latencyPlugin(
  profile: LatencyProfile | (() => LatencyProfile) = {},
): RuntimePlugin {
  const getProfile = typeof profile === 'function' ? profile : () => profile;
  return {
    name: 'latency',
    register(app) {
      app.addHook('onRequest', async (req) => {
        const p = getProfile();
        const floor = p.floorMs ?? 0;
        const jitter = p.jitterMs ?? 0;
        if (floor === 0 && jitter === 0) return;
        const extra =
          jitter === 0
            ? 0
            : p.deterministic
              ? deterministicJitter(req.method, req.url, jitter)
              : Math.random() * jitter;
        const total = floor + extra;
        if (total > 0) await new Promise((r) => setTimeout(r, total));
      });
    },
  };
}

function deterministicJitter(method: string, url: string, max: number): number {
  const key = `${method} ${url}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const normalized = (hash >>> 0) / 0xffffffff;
  return normalized * max;
}
