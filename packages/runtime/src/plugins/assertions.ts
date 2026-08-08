import type { RuntimePlugin } from '../runtime.js';

/**
 * Assertion rules for a project. Each rule is scoped to a method+path glob and
 * a kind. Failure invokes `onViolation` with the rule and a small context
 * object; the plugin never rewrites the response so an assertion is
 * observation-only by design.
 */
export interface AssertionRule {
  readonly id: string;
  readonly name: string;
  readonly endpoint?: string | null;
  readonly kind: 'latency' | 'field' | 'status';
  readonly config: Record<string, unknown>;
  readonly enabled?: boolean;
}

export interface ViolationContext {
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly durationMs: number;
  readonly body?: unknown;
  readonly detail?: string;
}

export type OnViolation = (rule: AssertionRule, ctx: ViolationContext) => void | Promise<void>;

/**
 * Wraps the runtime with per-request assertion checks. Rules matching the
 * request path (glob-style `/pets/*` or exact) are evaluated on the response;
 * violations fire the callback asynchronously so a slow event sink can never
 * block the response.
 */
export function assertionsPlugin(
  rules: readonly AssertionRule[] | (() => readonly AssertionRule[]),
  onViolation: OnViolation | (() => OnViolation),
): RuntimePlugin {
  const getRules = typeof rules === 'function' ? rules : () => rules;
  const getSink = typeof onViolation === 'function' && onViolation.length === 0
    ? (onViolation as () => OnViolation)
    : () => onViolation as OnViolation;
  return {
    name: 'assertions',
    register(app) {
      app.addHook('onRequest', async (req) => {
        // Stash a start timestamp so latency assertions get a real duration.
        (req as unknown as { _carbonStart: number })._carbonStart = Date.now();
      });

      app.addHook('onSend', async (req, reply, payload) => {
        const start = (req as unknown as { _carbonStart?: number })._carbonStart ?? Date.now();
        const durationMs = Date.now() - start;
        const status = reply.statusCode;
        const url = req.url;
        const method = req.method;

        const active = getRules().filter(
          (r) => r.enabled !== false && matches(r.endpoint ?? null, method, url),
        );
        if (active.length === 0) return payload;

        // Parse body lazily and only if a field assertion needs it.
        let parsedBody: unknown | undefined;
        const parseBody = (): unknown => {
          if (parsedBody !== undefined) return parsedBody;
          if (typeof payload === 'string') {
            try {
              parsedBody = JSON.parse(payload);
            } catch {
              parsedBody = null;
            }
          } else if (payload && typeof payload === 'object') {
            parsedBody = payload;
          } else {
            parsedBody = null;
          }
          return parsedBody;
        };

        for (const rule of active) {
          const violation = evaluate(rule, { method, url, status, durationMs, parseBody });
          if (violation) {
            const sink = getSink();
            // Fire and forget — the response has already been formed and the
            // event sink is not on the request's critical path.
            void Promise.resolve(
              sink(rule, {
                method,
                url,
                status,
                durationMs,
                body: parsedBody,
                detail: violation,
              }),
            ).catch(() => {
              /* the sink logs its own failures; do not throw into onSend */
            });
          }
        }
        return payload;
      });
    },
  };
}

interface EvalInput {
  method: string;
  url: string;
  status: number;
  durationMs: number;
  parseBody: () => unknown;
}

function evaluate(rule: AssertionRule, input: EvalInput): string | null {
  const cfg = rule.config as Record<string, unknown>;
  switch (rule.kind) {
    case 'latency': {
      const max = numeric(cfg.maxMs);
      if (max !== null && input.durationMs > max) {
        return `latency ${input.durationMs}ms exceeded maxMs=${max}`;
      }
      return null;
    }
    case 'status': {
      const allowed = Array.isArray(cfg.allowed)
        ? (cfg.allowed as unknown[]).map(Number).filter((n) => Number.isFinite(n))
        : null;
      if (allowed && !allowed.includes(input.status)) {
        return `status ${input.status} not in allowed=${allowed.join(',')}`;
      }
      const maxStatus = numeric(cfg.maxStatus);
      if (maxStatus !== null && input.status >= maxStatus) {
        return `status ${input.status} >= maxStatus=${maxStatus}`;
      }
      return null;
    }
    case 'field': {
      const path = typeof cfg.path === 'string' ? cfg.path : null;
      if (!path) return null;
      const body = input.parseBody();
      const value = extract(body, path);
      if (cfg.notNull === true && (value === null || value === undefined)) {
        return `field ${path} is null/undefined`;
      }
      if (cfg.equals !== undefined && value !== cfg.equals) {
        return `field ${path} !== expected`;
      }
      return null;
    }
    default:
      return null;
  }
}

function matches(endpoint: string | null, method: string, url: string): boolean {
  if (!endpoint) return true;
  // Optional "METHOD /path" prefix.
  const parts = endpoint.split(' ');
  let pattern = endpoint;
  if (parts.length === 2 && parts[0] && parts[1]) {
    if (parts[0].toUpperCase() !== method.toUpperCase()) return false;
    pattern = parts[1];
  }
  if (pattern.endsWith('*')) return url.startsWith(pattern.slice(0, -1));
  return url === pattern || url.startsWith(`${pattern}?`);
}

function numeric(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function extract(root: unknown, path: string): unknown {
  // Very small dotted-path resolver: `a.b.c`, no brackets/wildcards.
  const segments = path.split('.').filter(Boolean);
  let cur: unknown = root;
  for (const seg of segments) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}
