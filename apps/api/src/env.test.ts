import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { parseEnv } from './env.js';

const baseEnv = {
  DATABASE_URL: 'postgresql://user:pass@example.com:5432/carbon',
};

describe('env parsing', () => {
  it('defaults Redis only outside production', () => {
    const env = parseEnv({ ...baseEnv, NODE_ENV: 'development' });
    expect(env.REDIS_URL).toBe('redis://127.0.0.1:6379');
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
