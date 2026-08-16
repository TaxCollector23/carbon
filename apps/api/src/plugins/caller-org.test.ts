import { describe, expect, it } from 'vitest';
import { isCarbonError } from '@carbon/core';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedRequest } from './api-key.js';
import type { SessionAuthenticatedRequest } from './session-auth.js';
import { resolveCallerOrg } from './caller-org.js';

/**
 * Build a request stub with just enough of Fastify's shape to exercise the
 * resolver. Everything the helper reads (`apiKey`, `sessionUser`) is stamped
 * directly onto the same object routes see, so we don't pull in the whole
 * Fastify stack for a pure-function test.
 */
function makeReq(
  parts: {
    apiKey?: AuthenticatedRequest['apiKey'];
    sessionUser?: SessionAuthenticatedRequest['sessionUser'];
  } = {},
): FastifyRequest {
  const req = {} as FastifyRequest;
  if (parts.apiKey) (req as AuthenticatedRequest).apiKey = parts.apiKey;
  if (parts.sessionUser) (req as SessionAuthenticatedRequest).sessionUser = parts.sessionUser;
  return req;
}

const apiKeyFor = (orgId: string): AuthenticatedRequest['apiKey'] => ({
  id: 'k',
  orgId,
  prefix: 'p',
  scopes: ['admin'],
  projectIds: null,
  expiresAt: null,
});

describe('resolveCallerOrg — precedence', () => {
  it('prefers apiKey.orgId over every other source', () => {
    const req = makeReq({
      apiKey: apiKeyFor('org-key'),
      sessionUser: { id: 'u', email: 'e', orgId: 'org-session' },
    });
    expect(resolveCallerOrg(req, { queryOrg: 'org-query' })).toBe('org-key');
  });

  it('falls back to sessionUser.orgId when no api key is present', () => {
    const req = makeReq({ sessionUser: { id: 'u', email: 'e', orgId: 'org-session' } });
    expect(resolveCallerOrg(req, { queryOrg: 'org-query' })).toBe('org-session');
  });

  it('falls back to queryOrg when neither api key nor session carries an org', () => {
    const req = makeReq();
    expect(resolveCallerOrg(req, { queryOrg: 'org-query', mode: 'optional' })).toBe('org-query');
  });

  it('does not accept queryOrg for an authenticated session with no membership', () => {
    const req = makeReq({ sessionUser: { id: 'u', email: 'user@example.com' } });
    expect(resolveCallerOrg(req, { queryOrg: 'org-query', mode: 'optional' })).toBeUndefined();
  });

  it('does not read query.orgId off the request automatically', () => {
    // Historical routes like billing must not silently start accepting a query
    // fallback just because they now go through the shared resolver.
    const req = makeReq();
    (req as FastifyRequest & { query?: { orgId?: string } }).query = { orgId: 'sneaky' };
    expect(resolveCallerOrg(req, { mode: 'optional' })).toBeUndefined();
  });
});

describe('resolveCallerOrg — modes', () => {
  it('throw mode raises CARBON_INVALID_INPUT when nothing resolves', () => {
    let caught: unknown;
    try {
      resolveCallerOrg(makeReq());
    } catch (err) {
      caught = err;
    }
    expect(isCarbonError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe('CARBON_INVALID_INPUT');
  });

  it('throw mode honours a custom message', () => {
    let caught: unknown;
    try {
      resolveCallerOrg(makeReq(), { message: 'billing needs a key' });
    } catch (err) {
      caught = err;
    }
    expect((caught as { message: string }).message).toBe('billing needs a key');
  });

  it('return-empty mode returns undefined instead of throwing', () => {
    expect(resolveCallerOrg(makeReq(), { mode: 'return-empty' })).toBeUndefined();
  });

  it('optional mode returns undefined instead of throwing', () => {
    expect(resolveCallerOrg(makeReq(), { mode: 'optional' })).toBeUndefined();
  });

  it('every mode returns the resolved org when one is present', () => {
    const req = makeReq({ apiKey: apiKeyFor('org-x') });
    expect(resolveCallerOrg(req)).toBe('org-x');
    expect(resolveCallerOrg(req, { mode: 'return-empty' })).toBe('org-x');
    expect(resolveCallerOrg(req, { mode: 'optional' })).toBe('org-x');
  });
});
