import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpRecordingProxy } from './http.js';

async function upstreamThat(handler: Parameters<typeof createServer>[0]): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server: Server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe('HttpRecordingProxy', () => {
  let upstream: { url: string; close: () => Promise<void> } | null = null;

  beforeEach(async () => {
    upstream = await upstreamThat((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ path: req.url, method: req.method }));
    });
  });

  afterEach(async () => {
    if (upstream) await upstream.close();
    upstream = null;
  });

  it('proxies requests and captures the exchange with redacted secrets', async () => {
    const proxy = new HttpRecordingProxy();
    const handle = await proxy.start({ target: upstream!.url });

    const res = await fetch(`${handle.url}/customers/42?x=1`, {
      headers: { authorization: 'Bearer sk_secret_do_not_leak' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; method: string };
    expect(body.method).toBe('GET');
    expect(body.path).toBe('/customers/42?x=1');

    const recording = await handle.stop();
    expect(recording.exchanges).toHaveLength(1);
    const [exchange] = recording.exchanges;
    expect(exchange?.request.headers.authorization).toBe('[redacted]');
    expect(exchange?.redactions).toContain('authorization');
    expect(exchange?.response.status).toBe(200);
    expect(exchange?.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
