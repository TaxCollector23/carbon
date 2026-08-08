import pino, { type Logger as PinoLogger, type LoggerOptions } from 'pino';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

/**
 * Carbon's logger interface. Every package accepts a `Logger` via constructor
 * or factory — no module-level singletons, no console.log. This keeps packages
 * testable and lets the runtime attach request-scoped context.
 */
export interface Logger {
  readonly level: LogLevel;
  trace(msg: string, ctx?: Record<string, unknown>): void;
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

class PinoAdapter implements Logger {
  constructor(private readonly p: PinoLogger) {}
  get level(): LogLevel {
    return this.p.level as LogLevel;
  }
  trace(msg: string, ctx?: Record<string, unknown>) {
    this.p.trace(ctx ?? {}, msg);
  }
  debug(msg: string, ctx?: Record<string, unknown>) {
    this.p.debug(ctx ?? {}, msg);
  }
  info(msg: string, ctx?: Record<string, unknown>) {
    this.p.info(ctx ?? {}, msg);
  }
  warn(msg: string, ctx?: Record<string, unknown>) {
    this.p.warn(ctx ?? {}, msg);
  }
  error(msg: string, ctx?: Record<string, unknown>) {
    this.p.error(ctx ?? {}, msg);
  }
  child(bindings: Record<string, unknown>): Logger {
    return new PinoAdapter(this.p.child(bindings));
  }
}

export interface CreateLoggerOptions {
  readonly level?: LogLevel;
  readonly pretty?: boolean;
  readonly name?: string;
}

const REDACT_KEYS = [
  'password',
  'token',
  'apiKey',
  'api_key',
  'authorization',
  'set-cookie',
  'cookie',
  '*.password',
  '*.token',
  '*.apiKey',
  '*.authorization',
];

export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  const options: LoggerOptions = {
    level: opts.level ?? 'info',
    name: opts.name,
    redact: { paths: REDACT_KEYS, censor: '[redacted]' },
  };

  if (opts.pretty) {
    try {
      return new PinoAdapter(
        pino({
          ...options,
          transport: {
            // The module is `pino-pretty`. `pino/pretty` is not a resolvable
            // target and made pino throw at construction — which meant every
            // process using the default dev logger died before it could log
            // why.
            target: 'pino-pretty',
            options: { colorize: true, singleLine: true, translateTime: 'HH:MM:ss.l' },
          },
        }),
      );
    } catch (err) {
      // Pretty printing is a developer convenience. If the transport cannot
      // load — not installed, bundled build, worker thread restrictions — fall
      // back to JSON on stdout rather than taking the service down with it.
      const fallback = pino(options);
      fallback.warn(
        { message: err instanceof Error ? err.message : String(err) },
        'logger.pretty_unavailable — falling back to JSON output',
      );
      return new PinoAdapter(fallback);
    }
  }

  return new PinoAdapter(pino(options));
}

/** No-op logger for unit tests. */
export const NoopLogger: Logger = {
  level: 'silent',
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return NoopLogger;
  },
};
