import { describe, expect, it } from 'vitest';
import { isTransient, mapDriverError } from './errors.js';
import { statusFor } from './server.js';

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
    ['57014', 503],
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

  it('ignores Node error codes that merely share the `code` field', () => {
    expect(mapDriverError(Object.assign(new Error('nope'), { code: 'ECONNREFUSED' }))).toBeNull();
    expect(
      mapDriverError(Object.assign(new Error('nope'), { code: 'ERR_INVALID_ARG_TYPE' })),
    ).toBeNull();
    expect(mapDriverError(new Error('plain'))).toBeNull();
    expect(mapDriverError(null)).toBeNull();
    expect(mapDriverError('23505')).toBeNull();
  });
});
