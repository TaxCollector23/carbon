import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { CarbonError, makeId, NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';

export interface MintedApiKey {
  readonly id: string;
  readonly presented: string; // shown ONCE — never stored
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly projectIds: readonly string[] | null;
  readonly expiresAt: Date | null;
  readonly rotatedFromId: string | null;
}

export interface MintApiKeyInput {
  readonly orgId: string;
  readonly name: string;
  /** Defaults to `['admin']` to preserve pre-RBAC behavior. */
  readonly scopes?: readonly ('read' | 'write' | 'admin')[];
  /** Null → all projects in org. Non-null → pinned to these project ids. */
  readonly projectIds?: readonly string[] | null;
  /** When set, key auto-expires at this instant. Null → never-expiring. */
  readonly expiresAt?: Date | null;
  /** Source key id when minted via the rotation flow. */
  readonly rotatedFromId?: string | null;
}

/**
 * Mint an API key. The returned `presented` value must be shown to the user
 * immediately and never persisted server-side. Only the SHA-256 of the secret
 * portion is kept in the database.
 */
export async function mintApiKey(ctx: AppContext, input: MintApiKeyInput): Promise<MintedApiKey> {
  const id = makeId('key');
  const prefix = randomBytes(6).toString('hex'); // 12 chars
  const secret = randomBytes(24).toString('base64url'); // 32 chars, url-safe
  const presented = `ck_live_${prefix}.${secret}`;
  const hash = createHash('sha256').update(secret).digest('hex');
  const scopes = input.scopes && input.scopes.length > 0 ? [...input.scopes] : ['admin'];
  const projectIds = input.projectIds === undefined ? null : input.projectIds;
  const expiresAt = input.expiresAt ?? null;
  const rotatedFromId = input.rotatedFromId ?? null;

  await ctx.db.insert(schema.apiKeys).values({
    id,
    orgId: input.orgId,
    name: input.name,
    hash,
    prefix,
    scopes,
    projectIds: projectIds === null ? null : [...projectIds],
    expiresAt,
    rotatedFromId,
  });

  return { id, presented, prefix, scopes, projectIds, expiresAt, rotatedFromId };
}

export interface RotateApiKeyInput {
  readonly sourceId: string;
  /** The caller's org — enforced against the source key's org. */
  readonly orgId: string;
  /** Length of the overlap window in seconds. 60 <= x <= 7 days. */
  readonly graceSeconds: number;
  /** Overrides for the freshly minted key; inherit from source when absent. */
  readonly scopes?: readonly ('read' | 'write' | 'admin')[];
  readonly projectIds?: readonly string[] | null;
  /** Injectable clock for tests. Defaults to `new Date()`. */
  readonly now?: () => Date;
}

export interface RotateApiKeyResult {
  readonly minted: MintedApiKey;
  readonly source: {
    readonly id: string;
    readonly prefix: string;
    readonly expiresAt: Date;
  };
}

/**
 * Rotate an API key: mint a successor with the same (or overridden)
 * scopes/projectIds and set the source's `expiresAt` to `now + graceSeconds`.
 * The source is NOT revoked, so callers still authenticating with it keep
 * working through the grace window. After the window elapses the SQL guard
 * in the auth plugin rejects the source and the successor takes over.
 */
export async function rotateApiKey(
  ctx: AppContext,
  input: RotateApiKeyInput,
): Promise<RotateApiKeyResult> {
  const now = (input.now ?? (() => new Date()))();

  const [source] = await ctx.db
    .select()
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.id, input.sourceId), eq(schema.apiKeys.orgId, input.orgId)))
    .limit(1);
  if (!source) throw new NotFoundError('api key', input.sourceId);
  if (source.revokedAt) {
    throw new CarbonError({
      code: 'CARBON_INVALID_INPUT',
      message: 'Cannot rotate a revoked key',
      expose: true,
    });
  }
  if (source.expiresAt && source.expiresAt.getTime() <= now.getTime()) {
    throw new CarbonError({
      code: 'CARBON_INVALID_INPUT',
      message: 'Cannot rotate an expired key',
      expose: true,
    });
  }

  const scopes = input.scopes ?? (source.scopes as ('read' | 'write' | 'admin')[]);
  const projectIds = input.projectIds === undefined ? source.projectIds : input.projectIds;

  const sourceExpiresAt = new Date(now.getTime() + input.graceSeconds * 1000);
  // Never extend an already-shorter expiration. Rotating a short-lived key
  // must not accidentally grant it more lifetime.
  const effectiveSourceExpiresAt =
    source.expiresAt && source.expiresAt.getTime() < sourceExpiresAt.getTime()
      ? source.expiresAt
      : sourceExpiresAt;

  const doWork = async (tx: AppContext['db']): Promise<RotateApiKeyResult> => {
    const minted = await mintApiKey({ ...ctx, db: tx } as AppContext, {
      orgId: source.orgId,
      name: `${source.name} (rotated)`,
      scopes,
      projectIds,
      rotatedFromId: source.id,
    });
    const updated = await tx
      .update(schema.apiKeys)
      .set({ expiresAt: effectiveSourceExpiresAt })
      .where(and(eq(schema.apiKeys.id, source.id), isNull(schema.apiKeys.revokedAt)))
      .returning({ id: schema.apiKeys.id, expiresAt: schema.apiKeys.expiresAt });
    const [row] = updated;
    if (!row) {
      // Source disappeared or was revoked between the SELECT and UPDATE.
      throw new CarbonError({
        code: 'CARBON_CONFLICT',
        message: 'Source key changed during rotation',
        expose: true,
      });
    }
    return {
      minted,
      source: {
        id: source.id,
        prefix: source.prefix,
        expiresAt: row.expiresAt ?? effectiveSourceExpiresAt,
      },
    };
  };

  const db = ctx.db as unknown as {
    transaction?: (
      fn: (tx: AppContext['db']) => Promise<RotateApiKeyResult>,
    ) => Promise<RotateApiKeyResult>;
  };
  if (typeof db.transaction === 'function') {
    return db.transaction(async (tx) => doWork(tx));
  }
  return doWork(ctx.db);
}
