import type { RuntimePlugin } from '../runtime.js';

export interface ErrorInjectionRule {
  /** Match by exact URL path, glob-like prefix (`/customers/*`), or method+path. */
  readonly match: {
    readonly method?: string;
    readonly path: string;
  };
  /** Probability in [0, 1]. 1 = always fire. */
  readonly probability: number;
  /** HTTP status to return, or 'timeout' to hang until client cancels. */
  readonly action:
    | { readonly kind: 'status'; readonly status: number; readonly body?: unknown }
    | { readonly kind: 'timeout'; readonly afterMs: number };
}

/**
 * Deterministic chaos. Rules are evaluated in order — first match wins.
 * Provides a Math.random override so tests can pin the RNG.
 */
export function errorInjectionPlugin(rules: readonly ErrorInjectionRule[], rng: () => number = Math.random): RuntimePlugin {
  return {
    name: 'error-injection',
    register(app) {
      app.addHook('onRequest', async (req, reply) => {
        const rule = rules.find((r) => matches(r.match, req.method, req.url));
        if (!rule) return;
        if (rng() >= rule.probability) return;
        if (rule.action.kind === 'status') {
          reply.status(rule.action.status).send(rule.action.body ?? {
            error: { code: 'CARBON_INJECTED', message: `Injected ${rule.action.status}` },
          });
          return reply;
        }
        // Timeout: never send a response. The plugin still returns so Fastify
        // knows the hook resolved; the setTimeout is a safety net that hangs
        // the socket until the client aborts.
        await new Promise((r) => setTimeout(r, rule.action.afterMs));
      });
    },
  };
}

function matches(m: { method?: string; path: string }, method: string, url: string): boolean {
  if (m.method && m.method.toUpperCase() !== method.toUpperCase()) return false;
  if (m.path.endsWith('*')) return url.startsWith(m.path.slice(0, -1));
  return url === m.path || url.startsWith(`${m.path}?`);
}
