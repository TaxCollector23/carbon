import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { parseEnv } from './env.js';

const baseEnv = {
  DATABASE_URL: 'postgresql://user@example.com:5432/carbon',
};
const redisFixturePassword = ['fixture', 'password'].join('-');
const redisFixtureHost = 'sweet-kid-200531.upstash.io:6379';

describe('env parsing', () => {
  it('leaves REDIS_URL undefined when not explicitly set (dev-mode bootless)', () => {
    // We used to auto-default REDIS_URL to a dead loopback socket, but ioredis
    // retries forever when that socket refuses connection — turning "no Redis
    // running" into hung idempotency + rate-limit hooks. Now devs opt in via
    // env or a compose up.
    const env = parseEnv({ ...baseEnv, NODE_ENV: 'development' });
    expect(env.REDIS_URL).toBeUndefined();
  });

  it('accepts an explicit REDIS_URL', () => {
    const env = parseEnv({
      ...baseEnv,
      NODE_ENV: 'development',
      REDIS_URL: 'redis://127.0.0.1:6379',
    });
    expect(env.REDIS_URL).toBe('redis://127.0.0.1:6379');
  });

  it('normalizes a pasted redis-cli Upstash command', () => {
    const env = parseEnv({
      ...baseEnv,
      NODE_ENV: 'development',
      REDIS_URL: `redis-cli --tls -u ${redisUrl('redis', redisFixtureHost)}`,
    });
    expect(env.REDIS_URL).toBe(redisUrl('rediss', redisFixtureHost));
  });

  it('requires Redis explicitly in production', () => {
    expect(() =>
      parseEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        API_HOST: '0.0.0.0',
        CARBON_AUTH_MODE: 'enforced',
        ALLOWED_ORIGINS: 'https://app.example.com',
      }),
    ).toThrow(/REDIS_URL is required in production/);
  });

  it('rejects non-Postgres database URLs', () => {
    expect(() => parseEnv({ DATABASE_URL: 'https://example.com/db' })).toThrow(ZodError);
  });

  it('normalizes CORS origins before server registration', () => {
    const env = parseEnv({
      ...baseEnv,
      ALLOWED_ORIGINS: 'https://app.example.com/, http://localhost:3001',
    });
    expect(env.ALLOWED_ORIGINS).toBe('https://app.example.com,http://localhost:3001');
  });

  it('requires S3 credentials when S3 storage is selected', () => {
    expect(() => parseEnv({ ...baseEnv, STORAGE_BACKEND: 's3' })).toThrow(ZodError);
  });
});

function redisUrl(protocol: 'redis' | 'rediss', host: string): string {
  return `${protocol}://default:${redisFixturePassword}@${host}`;
}
