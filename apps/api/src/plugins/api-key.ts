import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, isNull, or, gt, sql as dsql } from 'drizzle-orm';
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
 * Unauthenticated routes come from `publicPaths` — see `PUBLIC_PATHS` in
 * `server.ts`. Everything else requires a key unless
 * `CARBON_AUTH_MODE=disabled`.
 */

const KEY_PATTERN = /^ck_live_([a-f0-9]{12})\.([A-Za-z0-9_-]{32,128})$/;

export interface ApiKeyPluginOptions {
  readonly mode: 'enforced' | 'disabled';
  readonly headerName?: string;
  /**
   * Paths served without a key. Defaults to {@link DEFAULT_PUBLIC_PATHS};
   * `server.ts` passes the canonical list so operational endpoints
   * (`/metrics`, `/openapi.json`, `/docs`) stay reachable to scrapers.
   */
  readonly publicPaths?: Iterable<string>;
}

/**
 * Liveness and readiness only. The server passes a wider set — see
 * `PUBLIC_PATHS` in `server.ts` — but a bare registration must stay
 * closed by default.
 */
export const DEFAULT_PUBLIC_PATHS: readonly string[] = ['/health', '/ready'];

export interface AuthenticatedRequest extends FastifyRequest {
  apiKey?: {
    id: string;
    orgId: string;
    prefix: string;
    scopes: string[];
    /** null → key has access to every project in its org. */
    projectIds: string[] | null;
    /** null → never expires; a Date past now() is rejected before this fires. */
    expiresAt: Date | null;
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
  const publicPaths = new Set(opts.publicPaths ?? DEFAULT_PUBLIC_PATHS);

  app.addHook('onRequest', async (req, reply) => {
    if (isPublicPath(publicPaths, pathname(req.url))) return;
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
      .where(
        and(
          eq(schema.apiKeys.prefix, prefix),
          isNull(schema.apiKeys.revokedAt),
          or(isNull(schema.apiKeys.expiresAt), gt(schema.apiKeys.expiresAt, dsql`now()`)),
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      throw new CarbonError({
        code: 'CARBON_UNAUTHENTICATED',
        message: 'Unknown API key',
        expose: true,
      });
    }

    const presentedHash = sha256(secret);
    const row = rows[0]!;
    if (!hashMatches(presentedHash, row.hash)) {
      throw new CarbonError({
        code: 'CARBON_UNAUTHENTICATED',
        message: 'Invalid API key',
        expose: true,
      });
    }

    // Belt-and-suspenders: the SQL guard above already excludes expired rows
    // in production, but the app clock is the source of truth for the error
    // message and lets tests exercise the boundary without stubbing SQL now().
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      throw new CarbonError({
        code: 'CARBON_UNAUTHENTICATED',
        message: 'API key expired',
        details: { expiredAt: row.expiresAt.toISOString() },
        expose: true,
      });
    }

    (req as AuthenticatedRequest).apiKey = {
      id: row.id,
      orgId: row.orgId,
      prefix: row.prefix,
      // Legacy rows (pre-scopes migration) would have `scopes = ['admin']` via
      // the column default; the guard here is belt-and-suspenders for tests or
      // hand-inserted rows.
      scopes: Array.isArray(row.scopes) && row.scopes.length > 0 ? row.scopes : ['admin'],
      projectIds: Array.isArray(row.projectIds) ? row.projectIds : null,
      expiresAt: row.expiresAt ?? null,
    };

    // Throttle lastUsedAt writes — write-amplifying Postgres on every request
    // (and busting HOT updates) is far worse than 5-minute staleness on a
    // human-facing metadata field.
    if (shouldTouchLastUsed(row.id, row.lastUsedAt)) {
      rememberTouch(row.id);
      // Wrapped in Promise.resolve so a driver that returns a non-promise
      // thenable (or a stubbed builder in tests) can't throw synchronously
      // on the auth path.
      void Promise.resolve(
        ctx.db
          .update(schema.apiKeys)
          .set({ lastUsedAt: new Date() })
          .where(eq(schema.apiKeys.id, row.id)),
      ).catch((err: unknown) => {
        ctx.logger.debug('api_key.touch_failed', {
          keyId: row.id,
          message: err instanceof Error ? err.message : String(err),
        });
      });
    }

    reply.header('x-carbon-key-prefix', row.prefix);
  });
}

function isPublicPath(publicPaths: ReadonlySet<string>, path: string): boolean {
  if (publicPaths.has(path)) return true;
  // `/docs` mounts sub-assets (`/docs/js/...`) under its prefix; a scraper or
  // browser hitting those must not be bounced to a 401.
  for (const candidate of publicPaths) {
    if (candidate.endsWith('/*') && path.startsWith(candidate.slice(0, -1))) return true;
  }
  return false;
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

const LAST_USED_TOUCH_WINDOW_MS = 5 * 60 * 1000;
/**
 * Bounded so a key-enumeration attempt can't grow this map without limit.
 * Only successfully authenticated keys are ever inserted, so the practical
 * ceiling is the org's key count — but the cap makes that guaranteed rather
 * than merely likely.
 */
const MAX_TRACKED_KEYS = 10_000;
const lastTouchedAt = new Map<string, number>();

function shouldTouchLastUsed(keyId: string, storedLastUsedAt: Date | null | undefined): boolean {
  const now = Date.now();
  const localLast = lastTouchedAt.get(keyId);
  if (localLast !== undefined && now - localLast < LAST_USED_TOUCH_WINDOW_MS) return false;
  if (!storedLastUsedAt) return true;
  return now - storedLastUsedAt.getTime() >= LAST_USED_TOUCH_WINDOW_MS;
}

function rememberTouch(keyId: string): void {
  if (lastTouchedAt.size >= MAX_TRACKED_KEYS && !lastTouchedAt.has(keyId)) {
    // Map iteration is insertion-ordered, so this evicts the oldest entry.
    const oldest = lastTouchedAt.keys().next();
    if (!oldest.done) lastTouchedAt.delete(oldest.value);
  }
  lastTouchedAt.set(keyId, Date.now());
}
