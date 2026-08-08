import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { CarbonError } from '@carbon/core';
import type { AuthenticatedRequest } from './api-key.js';

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

export function requireScope(required: Scope): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const apiKey = (req as ScopedRequest).apiKey;
    // Auth disabled (`CARBON_AUTH_MODE=disabled`) means there is no
    // authenticated key on the request; treat the guard as a no-op so local
    // dev without keys keeps working, mirroring the api-key plugin's own
    // early-return.
    if (!apiKey) return;
    if (!keyHasScope(apiKey.scopes, required)) {
      throw new CarbonError({
        code: 'CARBON_FORBIDDEN',
        message: `API key missing required scope: ${required}`,
        details: { required, held: apiKey.scopes },
        expose: true,
      });
    }
  };
}
