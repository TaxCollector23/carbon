import { createHash, randomBytes } from 'node:crypto';
import { makeId } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';

export interface MintedApiKey {
  readonly id: string;
  readonly presented: string; // shown ONCE — never stored
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly projectIds: readonly string[] | null;
}

export interface MintApiKeyInput {
  readonly orgId: string;
  readonly name: string;
  /** Defaults to `['admin']` to preserve pre-RBAC behavior. */
  readonly scopes?: readonly ('read' | 'write' | 'admin')[];
  /** Null → all projects in org. Non-null → pinned to these project ids. */
  readonly projectIds?: readonly string[] | null;
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

  await ctx.db.insert(schema.apiKeys).values({
    id,
    orgId: input.orgId,
    name: input.name,
    hash,
    prefix,
    scopes,
    projectIds: projectIds === null ? null : [...projectIds],
  });

  return { id, presented, prefix, scopes, projectIds };
}
