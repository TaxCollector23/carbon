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
const KEY_PATTERN = /^ck_live_([a-f0-9]{12})\.([A-Za-z0-9_-]{32,128})$/;

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
    if (PUBLIC_PATHS.has(pathname(req.url))) return;
    const raw = req.headers[header];
    if (Array.isArray(raw) && raw.length !== 1) {
      throw new CarbonError({
        code: 'CARBON_UNAUTHENTICATED',
        message: `Multiple ${header} headers are not allowed`,
        expose: true,
      });
    }
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

    const rows = await ctx.db
      .select()
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.prefix, prefix), isNull(schema.apiKeys.revokedAt)))
      .limit(10);
    if (rows.length === 0) {
      throw new CarbonError({
        code: 'CARBON_UNAUTHENTICATED',
        message: 'Unknown API key',
        expose: true,
      });
    }

    const presentedHash = sha256(secret);
    const row = rows.find((candidate) => hashMatches(presentedHash, candidate.hash));
    if (!row) {
      throw new CarbonError({
        code: 'CARBON_UNAUTHENTICATED',
        message: 'Invalid API key',
        expose: true,
      });
    }

    (req as AuthenticatedRequest).apiKey = { id: row.id, orgId: row.orgId, prefix: row.prefix };

    // Fire-and-forget touch — never block the request path on a metadata write.
    void (async () => {
      await ctx.db
        .update(schema.apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(schema.apiKeys.id, row.id));
    })().catch(() => {
      /* observability handles this */
    });

    reply.header('x-carbon-key-prefix', row.prefix);
  });
}

function splitKey(token: string): { prefix?: string; secret?: string } {
  const match = KEY_PATTERN.exec(token);
  if (!match) return {};
  const [, prefix, secret] = match;
  if (!prefix || !secret) return {};
  return { prefix, secret };
}

function sha256(input: string): Buffer {
  return createHash('sha256').update(input).digest();
}

function hashMatches(presentedHash: Buffer, storedHashHex: string): boolean {
  const storedHash = Buffer.from(storedHashHex, 'hex');
  return presentedHash.length === storedHash.length && timingSafeEqual(presentedHash, storedHash);
}

function pathname(url: string): string {
  return url.split('?')[0] ?? url;
}
