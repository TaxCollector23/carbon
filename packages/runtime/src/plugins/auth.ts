import type { RuntimePlugin } from '../runtime.js';

export interface AuthOptions {
  /**
   * Auth strategy. `permissive` accepts any presented token — useful for local
   * development. `strict` rejects unknown tokens. The set of accepted tokens
   * can be seeded via `tokens` or provided dynamically via `verify`.
   */
  readonly mode?: 'permissive' | 'strict';
  readonly scheme?: 'bearer' | 'api-key';
  /** Header name for API-key mode. Defaults to `x-api-key`. */
  readonly headerName?: string;
  /** Seed set of accepted tokens (compared exactly). */
  readonly tokens?: readonly string[];
  /** Async verifier — return true to accept, false to reject. */
  readonly verify?: (token: string) => Promise<boolean> | boolean;
  /** Paths to skip. Health/metadata endpoints usually go here. */
  readonly skip?: readonly string[];
}

/**
 * Runtime authentication plugin. Deliberately narrow — the goal is to catch
 * "missing key" bugs early, not to enforce production-grade access control.
 */
export function authPlugin(opts: AuthOptions = {}): RuntimePlugin {
  const mode = opts.mode ?? 'permissive';
  const scheme = opts.scheme ?? 'bearer';
  const header = (opts.headerName ?? 'x-api-key').toLowerCase();
  const skip = new Set(opts.skip ?? ['/__carbon/health']);
  const tokens = new Set(opts.tokens ?? []);
  const verify = opts.verify;

  return {
    name: 'auth',
    register(app, ctx) {
      app.addHook('onRequest', async (req, reply) => {
        if (skip.has(req.url) || skip.has(req.url.split('?')[0] ?? '')) return;

        const token = extractToken(
          req.headers as Record<string, string | string[] | undefined>,
          scheme,
          header,
        );
        if (!token) {
          if (mode === 'permissive') return;
          reply
            .status(401)
            .send({ error: { code: 'CARBON_UNAUTHENTICATED', message: 'Missing credentials' } });
          return reply;
        }
        if (tokens.has(token)) return;
        if (verify && (await verify(token))) return;
        if (mode === 'permissive') return;

        ctx.logger.warn('runtime.auth_rejected', { url: req.url });
        reply
          .status(401)
          .send({ error: { code: 'CARBON_UNAUTHENTICATED', message: 'Invalid credentials' } });
        return reply;
      });
    },
  };
}

function extractToken(
  headers: Record<string, string | string[] | undefined>,
  scheme: 'bearer' | 'api-key',
  headerName: string,
): string | null {
  if (scheme === 'api-key') {
    const raw = headers[headerName];
    if (Array.isArray(raw)) return raw[0] ?? null;
    return raw ?? null;
  }
  const auth = headers['authorization'];
  const value = Array.isArray(auth) ? auth[0] : auth;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1] ?? null;
}
