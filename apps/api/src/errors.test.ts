import { describe, expect, it, beforeEach } from 'vitest';
import { isTransient, mapDriverError } from './errors.js';
import { statusFor } from './server.js';
import {
  errorResultCountForTest,
  recordErrorResult,
  resetErrorResultCountersForTest,
} from './plugins/metrics.js';

/** Mirrors the shape `postgres` attaches to a server-side error. */
function pgError(code: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(`postgres said ${code}`), { code, ...extra });
}

describe('mapDriverError', () => {
  it('maps a unique violation to 409 without echoing the conflicting values', () => {
    const mapped = mapDriverError(
      pgError('23505', {
        constraint_name: 'projects_org_slug_unique',
        detail: 'Key (org_id, slug)=(org_1, acme) already exists.',
      }),
    );

    expect(mapped).not.toBeNull();
    expect(statusFor(mapped!.code)).toBe(409);
    expect(mapped!.expose).toBe(true);
    expect(mapped!.message).toContain('projects_org_slug_unique');
    // The driver's `detail` carries the actual row values — never surface it.
    expect(mapped!.message).not.toContain('acme');
  });

  it('maps a foreign key violation to 400', () => {
    const mapped = mapDriverError(pgError('23503', { constraint_name: 'projects_org_id_fk' }));
    expect(statusFor(mapped!.code)).toBe(400);
    expect(mapped!.details).toEqual({ constraint: 'projects_org_id_fk' });
  });

  it.each([
    ['23502', 400],
    ['23514', 400],
    ['22001', 400],
    ['40001', 409],
    ['40P01', 409],
    ['53300', 503],
    ['57014', 504],
    ['08006', 503],
  ])('maps SQLSTATE %s to HTTP %i', (code, status) => {
    const mapped = mapDriverError(pgError(code));
    expect(mapped, `expected ${code} to map`).not.toBeNull();
    expect(statusFor(mapped!.code)).toBe(status);
  });

  it('flags only the transient failures for retry', () => {
    expect(isTransient(mapDriverError(pgError('08006'))!)).toBe(true);
    expect(isTransient(mapDriverError(pgError('23505'))!)).toBe(false);
  });

  it('leaves unrecognized SQLSTATEs alone so they stay 500s', () => {
    // Guessing a status for an error we do not understand is worse than
    // admitting the failure was unexpected.
    expect(mapDriverError(pgError('XX000'))).toBeNull();
  });

  it('classifies TCP-level failures as a temporary dependency outage', () => {
    // Any driver that speaks TCP — Redis, S3, pg itself — surfaces these
    // codes when the socket fails before the protocol layer sees anything.
    const mapped = mapDriverError(Object.assign(new Error('nope'), { code: 'ECONNREFUSED' }));
    expect(mapped, 'ECONNREFUSED should map to a dependency-outage code').not.toBeNull();
    expect(mapped!.code).toBe('CARBON_DEPENDENCY_UNAVAILABLE');
    expect(statusFor(mapped!.code)).toBe(503);
    expect(isTransient(mapped!)).toBe(true);
  });

  it('leaves opaque Node error codes alone', () => {
    expect(
      mapDriverError(Object.assign(new Error('nope'), { code: 'ERR_INVALID_ARG_TYPE' })),
    ).toBeNull();
    expect(mapDriverError(new Error('plain'))).toBeNull();
    expect(mapDriverError(null)).toBeNull();
    expect(mapDriverError('23505')).toBeNull();
  });

  it.each([
    ['NoSuchKey', 'CARBON_NOT_FOUND', 404],
    ['AccessDenied', 'CARBON_FORBIDDEN', 403],
    ['SlowDown', 'CARBON_RATE_LIMITED', 429],
    ['ThrottlingException', 'CARBON_RATE_LIMITED', 429],
    ['TimeoutError', 'CARBON_TIMEOUT', 504],
  ])('maps S3 error name %s → %s (%i)', (name, code, status) => {
    const mapped = mapDriverError(Object.assign(new Error('s3 says nope'), { name }));
    expect(mapped, `expected ${name} to map`).not.toBeNull();
    expect(mapped!.code).toBe(code);
    expect(statusFor(mapped!.code)).toBe(status);
  });

  it.each([
    ['MaxRetriesPerRequestError', 'CARBON_DEPENDENCY_UNAVAILABLE', 503],
    ['ClusterAllFailedError', 'CARBON_DEPENDENCY_UNAVAILABLE', 503],
  ])('maps ioredis error %s → %s (%i)', (name, code, status) => {
    const mapped = mapDriverError(Object.assign(new Error('redis nope'), { name }));
    expect(mapped, `expected ${name} to map`).not.toBeNull();
    expect(mapped!.code).toBe(code);
    expect(statusFor(mapped!.code)).toBe(status);
    expect(isTransient(mapped!)).toBe(true);
  });

  it('maps BullMQ MaxAttemptsExceededError to CARBON_JOB_FAILED (500)', () => {
    const mapped = mapDriverError(
      Object.assign(new Error('exhausted'), { name: 'MaxAttemptsExceededError' }),
    );
    expect(mapped!.code).toBe('CARBON_JOB_FAILED');
    expect(statusFor(mapped!.code)).toBe(500);
  });

  it('maps ETIMEDOUT to CARBON_TIMEOUT (504)', () => {
    const mapped = mapDriverError(Object.assign(new Error('slow'), { code: 'ETIMEDOUT' }));
    expect(mapped!.code).toBe('CARBON_TIMEOUT');
    expect(statusFor(mapped!.code)).toBe(504);
  });
});

describe('error result counter', () => {
  beforeEach(() => {
    resetErrorResultCountersForTest();
  });

  it('bumps the counter each time recordErrorResult is called', () => {
    recordErrorResult('CARBON_DEPENDENCY_UNAVAILABLE');
    recordErrorResult('CARBON_DEPENDENCY_UNAVAILABLE');
    recordErrorResult('CARBON_TIMEOUT');
    expect(errorResultCountForTest('CARBON_DEPENDENCY_UNAVAILABLE')).toBe(2);
    expect(errorResultCountForTest('CARBON_TIMEOUT')).toBe(1);
    expect(errorResultCountForTest('CARBON_INTERNAL')).toBe(0);
  });
});
