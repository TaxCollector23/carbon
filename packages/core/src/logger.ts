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
    ...(opts.pretty
      ? {
          transport: {
            target: 'pino/pretty',
            options: { colorize: true, singleLine: true, translateTime: 'HH:MM:ss.l' },
          },
        }
      : {}),
  };
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
