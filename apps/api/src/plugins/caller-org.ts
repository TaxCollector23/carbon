import type { FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';
import { CarbonError } from '@carbon/core';
import type { AuthenticatedRequest } from './api-key.js';
import type { SessionAuthenticatedRequest } from './session-auth.js';

/**
 * How `resolveCallerOrg` should behave when no org can be resolved.
 *
 *   - `throw`         → raise `CARBON_INVALID_INPUT` (routes that used to 400)
 *   - `return-empty`  → return `undefined`; caller typically responds with an
 *                       empty list to keep the dashboard's dev-mode happy path
 *                       working
 *   - `optional`      → return `undefined`; caller may make its own decision
 *                       (e.g. list across all orgs in auth-disabled mode)
 */
export type CallerOrgMode = 'throw' | 'return-empty' | 'optional';

export interface ResolveCallerOrgOptions {
  /**
   * Explicit `?orgId=` fallback the route pulled off its own querystring.
   * Passed in rather than read automatically so routes that historically
   * rejected the query fallback (e.g. billing) don't accidentally start
   * accepting it.
   */
  queryOrg?: string;
  mode?: CallerOrgMode;
  /** Overridable message for `throw` mode. Defaults to a single shared string. */
  message?: string;
}

const DEFAULT_MESSAGE = 'orgId is required — attach an API key or authenticated session';

/**
 * Single source of truth for "which org is the caller acting as?".
 *
 * Precedence: API key > browser session > explicit query fallback. Every
 * route that used to keep its own copy of this rule now funnels through here
 * so the resolution order (and error shape) can only drift in one place.
 *
 * The overloads let TypeScript narrow the return type: `throw` mode
 * guarantees a string, the softer modes surface `undefined` for the caller
 * to handle explicitly.
 */
export function resolveCallerOrg(
  req: FastifyRequest,
  opts?: Omit<ResolveCallerOrgOptions, 'mode'> & { mode?: 'throw' },
): string;
export function resolveCallerOrg(
  req: FastifyRequest,
  opts: Omit<ResolveCallerOrgOptions, 'mode'> & { mode: 'return-empty' | 'optional' },
): string | undefined;
export function resolveCallerOrg(
  req: FastifyRequest,
  opts: ResolveCallerOrgOptions = {},
): string | undefined {
  const apiKey = (req as AuthenticatedRequest).apiKey;
  const session = (req as SessionAuthenticatedRequest).sessionUser;
  const orgId = apiKey?.orgId ?? session?.orgId ?? opts.queryOrg;
  if (orgId) return orgId;
  const mode = opts.mode ?? 'throw';
  if (mode === 'throw') {
    throw new CarbonError({
      code: 'CARBON_INVALID_INPUT',
      message: opts.message ?? DEFAULT_MESSAGE,
      expose: true,
    });
  }
  return undefined;
}

/**
 * Convenience wrapper for the common shape
 *   `(req, reply) => { const orgId = resolveCallerOrg(req, ...); ... }`.
 *
 * `mode='return-empty'` short-circuits with `{ data: [] }` when no org can
 * be resolved — matches the dev-mode behaviour dashboards rely on. In every
 * other mode the wrapper just hands the resolved (possibly undefined) org id
 * to the handler.
 */
export function withOrgFallback<T>(
  mode: CallerOrgMode,
  handler: (req: FastifyRequest, orgId: string | undefined, reply: FastifyReply) => Promise<T>,
): RouteHandlerMethod {
  return async function (req, reply) {
    // Cast: the runtime union `CallerOrgMode` here would not narrow to either
    // overload, but every mode value is a valid input to the implementation.
    const orgId = resolveCallerOrg(req, { mode: mode as 'return-empty' });
    if (!orgId && mode === 'return-empty') {
      return { data: [] } as unknown as T;
    }
    return handler(req, orgId, reply);
  } as RouteHandlerMethod;
}
