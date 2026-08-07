import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { createHash, timingSafeEqual } from 'node:crypto';
import { CarbonError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';

/**
 * API key authentication.
 *
 * Format: `ck_live_<prefix>.<secret>` where `prefix` is a public identifier
 * (indexable) and `secret` is the high-entropy portion. On presentation, we:
 *
 *   1. Split prefix/secret.
 *   2. Look up the key row by prefix (indexed).
 *   3. Compare hash(secret) in constant time.
 *
 * The DB stores only sha256(secret). This is intentional: even a full DB
 * dump does not expose the secrets. Argon2 would be stronger for
 * user-chosen passwords, but API keys are 256-bit random tokens where SHA-256
 * is safe and orders of magnitude cheaper on the hot path.
 *
 * Unauthenticated routes: /health, /ready. Everything else requires a key
 * unless `CARBON_AUTH_MODE=disabled`.
 */

const PUBLIC_PATHS = new Set(['/health', '/ready']);

export interface ApiKeyPluginOptions {
  readonly mode: 'enforced' | 'disabled';
  readonly headerName?: string;
}

export interface AuthenticatedRequest extends FastifyRequest {
  apiKey?: {
    id: string;
    orgId: string;
    prefix: string;
  };
}

export async function registerApiKeyAuth(
  app: FastifyInstance,
  ctx: AppContext,
  opts: ApiKeyPluginOptions,
): Promise<void> {
  if (opts.mode === 'disabled') {
    ctx.logger.warn('api.auth_disabled', {
      hint: 'set CARBON_AUTH_MODE=enforced in production',
    });
    return;
  }
  const header = (opts.headerName ?? 'x-carbon-key').toLowerCase();

  app.addHook('onRequest', async (req, reply) => {
    if (PUBLIC_PATHS.has(req.url) || PUBLIC_PATHS.has(req.url.split('?')[0] ?? '')) return;
    const raw = req.headers[header];
    const presented = Array.isArray(raw) ? raw[0] : raw;
    if (!presented) {
      throw new CarbonError({
        code: 'CARBON_UNAUTHENTICATED',
        message: `Missing ${header} header`,
        expose: true,
      });
    }
    const { prefix, secret } = splitKey(presented);
    if (!prefix || !secret) {
      throw new CarbonError({
        code: 'CARBON_UNAUTHENTICATED',
        message: 'Malformed API key',
        expose: true,
      });
    }

    const [row] = await ctx.db
      .select()
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.prefix, prefix), isNull(schema.apiKeys.revokedAt)))
      .limit(1);
    if (!row) {
      throw new CarbonError({
        code: 'CARBON_UNAUTHENTICATED',
        message: 'Unknown API key',
        expose: true,
      });
    }

    const presentedHash = sha256(secret);
    const storedHash = Buffer.from(row.hash, 'hex');
    if (presentedHash.length !== storedHash.length || !timingSafeEqual(presentedHash, storedHash)) {
      throw new CarbonError({
        code: 'CARBON_UNAUTHENTICATED',
        message: 'Invalid API key',
        expose: true,
      });
    }

    (req as AuthenticatedRequest).apiKey = { id: row.id, orgId: row.orgId, prefix: row.prefix };

    // Fire-and-forget touch — never block the request path on a metadata write.
    void ctx.db
      .update(schema.apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.apiKeys.id, row.id))
      .catch(() => {
        /* observability handles this */
      });

    reply.header('x-carbon-key-prefix', row.prefix);
  });
}

function splitKey(token: string): { prefix?: string; secret?: string } {
  const stripped = token.startsWith('ck_') ? token.slice(token.indexOf('_', 3) + 1) : token;
  const dot = stripped.indexOf('.');
  if (dot <= 0) return {};
  return { prefix: stripped.slice(0, dot), secret: stripped.slice(dot + 1) };
}

function sha256(input: string): Buffer {
  return createHash('sha256').update(input).digest();
}
