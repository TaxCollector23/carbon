import { CarbonError } from '@carbon/core';

/**
 * Translates driver-level failures into Carbon's typed error hierarchy.
 *
 * Without this, a duplicate project slug — an ordinary client mistake — leaves
 * Postgres as a raw `PostgresError` and falls through to the 500 branch of the
 * error handler. The caller sees "Internal error" for something they can fix,
 * and the operator gets a 5xx page for something that is not an outage.
 *
 * Only errors whose meaning is unambiguous are mapped. Anything else stays a
 * 500 on purpose: guessing at a status code is worse than admitting the
 * failure was unexpected.
 *
 * Codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export function mapDriverError(err: unknown): CarbonError | null {
  const code = driverErrorCode(err);
  if (!code) return null;

  switch (code) {
    case '23505': // unique_violation
      return new CarbonError({
        code: 'CARBON_CONFLICT',
        message: conflictMessage(err),
        cause: err,
        expose: true,
      });
    case '23503': // foreign_key_violation
      return new CarbonError({
        code: 'CARBON_INVALID_INPUT',
        message: 'A referenced record does not exist',
        details: constraintDetails(err),
        cause: err,
        expose: true,
      });
    case '23502': // not_null_violation
      return new CarbonError({
        code: 'CARBON_INVALID_INPUT',
        message: 'A required field was missing',
        details: constraintDetails(err),
        cause: err,
        expose: true,
      });
    case '23514': // check_violation
      return new CarbonError({
        code: 'CARBON_INVALID_INPUT',
        message: 'A field failed a database constraint',
        details: constraintDetails(err),
        cause: err,
        expose: true,
      });
    case '22001': // string_data_right_truncation
      return new CarbonError({
        code: 'CARBON_INVALID_INPUT',
        message: 'A field exceeded its maximum length',
        cause: err,
        expose: true,
      });
    case '40001': // serialization_failure
    case '40P01': // deadlock_detected
      return new CarbonError({
        code: 'CARBON_CONFLICT',
        message: 'The request conflicted with a concurrent write — retry it',
        cause: err,
        expose: true,
      });
    case '53300': // too_many_connections
    case '57014': // query_canceled (statement timeout)
    case '57P01': // admin_shutdown
    case '57P03': // cannot_connect_now
      return new CarbonError({
        code: 'CARBON_RUNTIME_UNAVAILABLE',
        message: 'The database is temporarily unavailable',
        cause: err,
        expose: true,
      });
    default:
      // Class 08 — connection exceptions. Always transient from the caller's
      // point of view, so 503 with a retry is the honest answer.
      if (code.startsWith('08')) {
        return new CarbonError({
          code: 'CARBON_RUNTIME_UNAVAILABLE',
          message: 'The database is temporarily unavailable',
          cause: err,
          expose: true,
        });
      }
      return null;
  }
}

/** True when the failure is worth retrying, i.e. the API should send Retry-After. */
export function isTransient(err: CarbonError): boolean {
  return err.code === 'CARBON_RUNTIME_UNAVAILABLE';
}

function driverErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const code = (err as { code?: unknown }).code;
  // Postgres SQLSTATEs are five characters. Node's own errors also use `code`
  // (`ECONNREFUSED`, `ERR_*`), so the length check keeps them out.
  if (typeof code === 'string' && code.length === 5 && /^[0-9A-Z]{5}$/.test(code)) return code;
  return undefined;
}

/**
 * Names the offending constraint rather than echoing the driver's message,
 * which can include the conflicting column values themselves.
 */
function conflictMessage(err: unknown): string {
  const constraint = constraintName(err);
  if (!constraint) return 'A record with these values already exists';
  return `A record with these values already exists (${constraint})`;
}

function constraintDetails(err: unknown): Record<string, unknown> | undefined {
  const constraint = constraintName(err);
  return constraint ? { constraint } : undefined;
}

function constraintName(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const record = err as { constraint_name?: unknown; constraint?: unknown };
  const name = record.constraint_name ?? record.constraint;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}
