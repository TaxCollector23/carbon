import { createServer } from 'node:net';

/**
 * TOCTOU-y port availability probe. The port can be grabbed between the
 * check and the caller's own listen() — that's the price for surfacing a
 * clear "port already in use" error before the SDK's Fastify listen call
 * throws deep in the pipeline. Callers should still handle listen errors.
 *
 * Kept as a shared helper because `emulate` and `serve` both need it and
 * the two copies of this had already drifted apart once.
 */
export async function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}
