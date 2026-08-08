import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { CarbonError } from '@carbon/core';
import type { AuthenticatedRequest } from './api-key.js';
import type { SessionAuthenticatedRequest } from './session-auth.js';

/**
 * Additive permission model. A key's scope array is a set. The requested scope
 * for a route is satisfied if the key holds it OR any higher scope:
 *
 *   admin  → satisfies admin, write, read
 *   write  → satisfies write, read
 *   read   → satisfies read
 *
 * Enforced as a Fastify preHandler so the auth plugin's onRequest hook has
 * already stashed `req.apiKey` (or, in `CARBON_AUTH_MODE=disabled`, has not —
 * in which case the guard is a no-op so local dev keeps working).
 */
export type Scope = 'read' | 'write' | 'admin';

export type ScopedRequest = AuthenticatedRequest;

const IMPLIES: Record<Scope, readonly Scope[]> = {
  read: ['read'],
  write: ['read', 'write'],
  admin: ['read', 'write', 'admin'],
};

export function keyHasScope(scopes: readonly string[], required: Scope): boolean {
  for (const held of scopes) {
    const implied = IMPLIES[held as Scope];
    if (implied && implied.includes(required)) return true;
  }
  return false;
}

/**
 * Membership role → equivalent scope grants for a human session. Kept in one
 * place so route guards and any future dashboard code agree on the mapping:
 *
 *   owner/admin → admin (implies read + write)
 *   member      → write (implies read)
 */
export function sessionRoleToScopes(role: 'owner' | 'admin' | 'member'): readonly Scope[] {
  if (role === 'owner' || role === 'admin') return ['admin'];
  return ['write'];
}

export function requireScope(required: Scope): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const apiKey = (req as ScopedRequest).apiKey;
    if (apiKey) {
      if (!keyHasScope(apiKey.scopes, required)) {
        throw new CarbonError({
          code: 'CARBON_FORBIDDEN',
          message: `API key missing required scope: ${required}`,
          details: { required, held: apiKey.scopes },
          expose: true,
        });
      }
      return;
    }

    // No API key on the request — try the Better Auth session path.
    // A signed-in user's effective scopes are derived from their org role.
    const sessionUser = (req as SessionAuthenticatedRequest).sessionUser;
    if (sessionUser?.role) {
      const held = sessionRoleToScopes(sessionUser.role);
      if (!keyHasScope(held, required)) {
        throw new CarbonError({
          code: 'CARBON_FORBIDDEN',
          message: `Session role missing required scope: ${required}`,
          details: { required, held, role: sessionUser.role },
          expose: true,
        });
      }
      return;
    }

    // Neither auth path has run (e.g. `CARBON_AUTH_MODE=disabled` in dev, or
    // an unauthenticated public route). Treat the guard as a no-op so local
    // dev keeps working, mirroring the api-key plugin's own early-return.
  };
}
