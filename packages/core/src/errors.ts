/**
 * Carbon's typed error hierarchy. Every package throws subclasses of CarbonError
 * so the CLI, runtime, and dashboard can pattern-match on `code` for actionable
 * diagnostics instead of parsing stack traces.
 *
 * The `expose` flag governs whether the message may be surfaced to end-users
 * (CLI output, HTTP response bodies). Internal errors are always redacted at
 * the boundary — see @carbon/runtime error mapper.
 */
export type ErrorCode =
  | 'CARBON_INTERNAL'
  | 'CARBON_INVALID_INPUT'
  | 'CARBON_NOT_FOUND'
  | 'CARBON_CONFLICT'
  | 'CARBON_UNAUTHENTICATED'
  | 'CARBON_FORBIDDEN'
  | 'CARBON_PARSE_FAILED'
  | 'CARBON_INGESTION_FAILED'
  | 'CARBON_STATE_VIOLATION'
  | 'CARBON_RUNTIME_UNAVAILABLE'
  | 'CARBON_STORAGE_FAILED'
  | 'CARBON_AI_PROVIDER_FAILED';

export interface CarbonErrorOptions {
  readonly code: ErrorCode;
  readonly message: string;
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;
  /** May the message be shown to end users? Defaults to false. */
  readonly expose?: boolean;
}

export class CarbonError extends Error {
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, unknown>>;
  readonly expose: boolean;

  constructor(opts: CarbonErrorOptions) {
    super(opts.message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = this.constructor.name;
    this.code = opts.code;
    this.details = opts.details ?? {};
    this.expose = opts.expose ?? false;
  }
}

export class InvalidInputError extends CarbonError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({ code: 'CARBON_INVALID_INPUT', message, details, expose: true });
  }
}

export class NotFoundError extends CarbonError {
  constructor(resource: string, id: string) {
    super({
      code: 'CARBON_NOT_FOUND',
      message: `${resource} ${id} not found`,
      details: { resource, id },
      expose: true,
    });
  }
}

export class ConflictError extends CarbonError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({ code: 'CARBON_CONFLICT', message, details, expose: true });
  }
}

export class StateViolationError extends CarbonError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({ code: 'CARBON_STATE_VIOLATION', message, details, expose: true });
  }
}

export class ParseFailedError extends CarbonError {
  constructor(message: string, cause?: unknown) {
    super({ code: 'CARBON_PARSE_FAILED', message, cause, expose: true });
  }
}

export const isCarbonError = (e: unknown): e is CarbonError => e instanceof CarbonError;
