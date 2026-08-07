import { createHash, randomBytes } from 'node:crypto';
import { makeId } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';

export interface MintedApiKey {
  readonly id: string;
  readonly presented: string; // shown ONCE — never stored
  readonly prefix: string;
}

/**
 * Mint an API key. The returned `presented` value must be shown to the user
 * immediately and never persisted server-side. Only the SHA-256 of the secret
 * portion is kept in the database.
 */
export async function mintApiKey(
  ctx: AppContext,
  input: { orgId: string; name: string },
): Promise<MintedApiKey> {
  const id = makeId('key');
  const prefix = randomBytes(6).toString('hex'); // 12 chars
  const secret = randomBytes(24).toString('base64url'); // 32 chars, url-safe
  const presented = `ck_live_${prefix}.${secret}`;
  const hash = createHash('sha256').update(secret).digest('hex');

  await ctx.db.insert(schema.apiKeys).values({
    id,
    orgId: input.orgId,
    name: input.name,
    hash,
    prefix,
  });

  return { id, presented, prefix };
}
