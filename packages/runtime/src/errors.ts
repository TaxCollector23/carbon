import type { CarbonError } from '@carbon/core';

/**
 * Maps typed Carbon errors to HTTP responses. Only `expose: true` messages
 * are relayed to the client verbatim; everything else is redacted to a
 * safe default. Details are always attached for local debugging via headers.
 */
export function toHttpError(err: CarbonError): { status: number; body: unknown } {
  const status = statusFor(err.code);
  const message = err.expose ? err.message : safeMessage(err.code);
  return {
    status,
    body: {
      error: {
        code: err.code,
        message,
        details: err.expose ? err.details : undefined,
      },
    },
  };
}

function statusFor(code: CarbonError['code']): number {
  switch (code) {
    case 'CARBON_NOT_FOUND':
      return 404;
    case 'CARBON_INVALID_INPUT':
      return 400;
    case 'CARBON_CONFLICT':
      return 409;
    case 'CARBON_UNAUTHENTICATED':
      return 401;
    case 'CARBON_FORBIDDEN':
      return 403;
    case 'CARBON_STATE_VIOLATION':
      return 422;
    case 'CARBON_RUNTIME_UNAVAILABLE':
      return 503;
    default:
      return 500;
  }
}

function safeMessage(code: CarbonError['code']): string {
  switch (code) {
    case 'CARBON_UNAUTHENTICATED':
      return 'Authentication required';
    case 'CARBON_FORBIDDEN':
      return 'Forbidden';
    case 'CARBON_RUNTIME_UNAVAILABLE':
      return 'Runtime temporarily unavailable';
    default:
      return 'Internal error';
  }
}
