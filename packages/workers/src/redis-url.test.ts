import { describe, expect, it } from 'vitest';
import { isRedisConnectionUrl, normalizeRedisUrl } from './redis-url.js';

const redisFixturePassword = ['fixture', 'password'].join('-');
const redisFixtureHost = 'sweet-kid-200531.upstash.io:6379';

describe('redis URL helpers', () => {
  it('preserves direct redis and rediss URLs', () => {
    expect(normalizeRedisUrl(' redis://127.0.0.1:6379 ')).toBe('redis://127.0.0.1:6379');
    expect(normalizeRedisUrl(redisUrl('rediss', `example.upstash.io:6379`))).toBe(
      redisUrl('rediss', `example.upstash.io:6379`),
    );
  });

  it('extracts and TLS-upgrades a pasted redis-cli command', () => {
    expect(normalizeRedisUrl(`redis-cli --tls -u ${redisUrl('redis', redisFixtureHost)}`)).toBe(
      redisUrl('rediss', redisFixtureHost),
    );
  });

  it('handles quoted --url arguments without leaking the command wrapper', () => {
    expect(normalizeRedisUrl('redis-cli --url="redis://localhost:6379/0" ping')).toBe(
      'redis://localhost:6379/0',
    );
  });

  it('rejects non-redis URLs after normalization', () => {
    expect(isRedisConnectionUrl(normalizeRedisUrl('https://example.com'))).toBe(false);
  });
});

function redisUrl(protocol: 'redis' | 'rediss', host: string): string {
  return `${protocol}://default:${redisFixturePassword}@${host}`;
}
