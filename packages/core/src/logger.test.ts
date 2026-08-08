import { describe, expect, it } from 'vitest';
import { createLogger, NoopLogger } from './logger.js';

describe('createLogger', () => {
  it('constructs a pretty logger without throwing', () => {
    // Regression: the transport target was `pino/pretty`, which pino cannot
    // resolve, so it threw during construction. Because `pretty` defaults to
    // on whenever NODE_ENV !== 'production', every dev boot of the API died
    // here before it could log the reason.
    const logger = createLogger({ level: 'silent', pretty: true, name: 'test' });
    expect(() => logger.info('hello', { a: 1 })).not.toThrow();
  });

  it('constructs a JSON logger without a transport', () => {
    const logger = createLogger({ level: 'silent', name: 'test' });
    expect(() => logger.info('hello')).not.toThrow();
  });

  it('honours the configured level', () => {
    expect(createLogger({ level: 'warn' }).level).toBe('warn');
  });

  it('produces working child loggers', () => {
    const child = createLogger({ level: 'silent' }).child({ reqId: 'abc' });
    expect(() => child.error('boom', { detail: 'x' })).not.toThrow();
  });

  it('NoopLogger swallows everything and stays chainable', () => {
    expect(() => NoopLogger.child({ a: 1 }).info('nothing')).not.toThrow();
    expect(NoopLogger.child({}).level).toBe('silent');
  });
});
