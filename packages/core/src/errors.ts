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
  | 'CARBON_AI_PROVIDER_FAILED'
  | 'CARBON_DEPENDENCY_UNAVAILABLE'
  | 'CARBON_TIMEOUT'
  | 'CARBON_RATE_LIMITED'
  | 'CARBON_JOB_FAILED'
  | 'CARBON_AI_QUALITY_BELOW_THRESHOLD';

export interface CarbonErrorOptions {
  readonly code: ErrorCode;
  readonly message: string;
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;
  /** May the message be shown to end users? Defaults to false. */
  readonly expose?: boolean;
  /**
   * A documentation URL explaining the error and how to fix it. When omitted
   * for a known `code`, defaults to a GitHub issue search for the slug where
   * the slug is the code lowercased with underscores turned into hyphens
   * (e.g. `CARBON_RATE_LIMITED` → `carbon-rate-limited`). Pass an empty
   * string to opt out of the default.
   */
  readonly help?: string;
}

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set([
  'CARBON_INTERNAL',
  'CARBON_INVALID_INPUT',
  'CARBON_NOT_FOUND',
  'CARBON_CONFLICT',
  'CARBON_UNAUTHENTICATED',
  'CARBON_FORBIDDEN',
  'CARBON_PARSE_FAILED',
  'CARBON_INGESTION_FAILED',
  'CARBON_STATE_VIOLATION',
  'CARBON_RUNTIME_UNAVAILABLE',
  'CARBON_STORAGE_FAILED',
  'CARBON_AI_PROVIDER_FAILED',
  'CARBON_DEPENDENCY_UNAVAILABLE',
  'CARBON_TIMEOUT',
  'CARBON_RATE_LIMITED',
  'CARBON_JOB_FAILED',
  'CARBON_AI_QUALITY_BELOW_THRESHOLD',
] satisfies readonly ErrorCode[]);

export function helpUrlForCode(code: string): string | undefined {
  if (!KNOWN_ERROR_CODES.has(code)) return undefined;
  const slug = code.toLowerCase().replace(/_/g, '-');
  return `https://github.com/TaxCollector23/carbon/issues?q=${slug}`;
}

export class CarbonError extends Error {
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, unknown>>;
  readonly expose: boolean;
  /**
   * Documentation URL for this error. Defaults to a canonical GitHub issue
   * search for known codes; consumers can override on construction. Never
   * present when the code is unknown and no explicit URL was supplied — we
   * don't want the docs site to inherit dead links from typos.
   */
  readonly help?: string;

  constructor(opts: CarbonErrorOptions) {
    super(opts.message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = this.constructor.name;
    this.code = opts.code;
    this.details = opts.details ?? {};
    this.expose = opts.expose ?? false;
    if (opts.help !== undefined) {
      this.help = opts.help === '' ? undefined : opts.help;
    } else {
      this.help = helpUrlForCode(opts.code);
    }
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
