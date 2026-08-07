import { createLogger, makeId } from '@carbon/core';
import { createDatabase, schema } from '@carbon/database';
import { and, eq } from 'drizzle-orm';
import { mintApiKey } from '../services/api-keys.js';
import type { AppContext } from '../context.js';

/**
 * One-shot bootstrap: creates the first organization and a full-access API
 * key so a fresh deploy is usable. Idempotent — safe to run more than once;
 * the org is only created if it does not already exist. Prints the presented
 * API key to stdout exactly once. Store it before the process exits.
 *
 * Run via `pnpm --filter @carbon/api bootstrap` from your machine or as a
 * one-shot deploy job.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const orgName = process.env.BOOTSTRAP_ORG_NAME ?? 'Personal';
  const orgSlug = (process.env.BOOTSTRAP_ORG_SLUG ?? 'personal').toLowerCase();
  const keyName = process.env.BOOTSTRAP_KEY_NAME ?? 'bootstrap';

  const logger = createLogger({
    level: 'info',
    pretty: process.env.NODE_ENV !== 'production',
    name: 'bootstrap',
  });
  const { db, sql } = createDatabase({
    url,
    maxConnections: 2,
    ssl: process.env.NODE_ENV === 'production' ? true : undefined,
  });

  try {
    const [existing] = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, orgSlug))
      .limit(1);
    const orgId = existing?.id ?? makeId('org');
    if (!existing) {
      await db.insert(schema.organizations).values({ id: orgId, slug: orgSlug, name: orgName });
      logger.info('bootstrap.org_created', { orgId, slug: orgSlug });
    } else {
      logger.info('bootstrap.org_exists', { orgId, slug: orgSlug });
    }

    // Only mint a new key if there is no active key on this org for this name.
    const [activeKey] = await db
      .select()
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.orgId, orgId), eq(schema.apiKeys.name, keyName)))
      .limit(1);
    if (activeKey && !activeKey.revokedAt) {
      logger.info('bootstrap.key_exists', {
        keyId: activeKey.id,
        prefix: activeKey.prefix,
        hint: 'delete the row or use a different BOOTSTRAP_KEY_NAME to re-mint',
      });
      return;
    }

    const ctx = { db } as unknown as AppContext;
    const key = await mintApiKey(ctx, { orgId, name: keyName });
    console.log('\ncarbon: bootstrap complete');
    console.log('  org        :', orgSlug, `(${orgId})`);
    console.log('  api key id :', key.id);
    console.log('  api key    :', key.presented);
    console.log('\nSTORE THE KEY NOW — it will not be shown again.\n');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('bootstrap failed:', err);
  process.exit(1);
});
