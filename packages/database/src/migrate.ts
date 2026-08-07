import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client.js';

/**
 * Programmatic migration runner. Called by:
 *   - `pnpm --filter @carbon/database migrate:apply` locally
 *   - one-shot deploy setup commands
 *
 * Idempotent: Drizzle tracks applied migrations in its own metadata table.
 * Running twice is a no-op. Safe to bake into every deploy.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const { db, sql } = createDatabase({
    url,
    maxConnections: 1,
    ssl: process.env.NODE_ENV === 'production' ? true : undefined,
  });
  console.log('carbon: applying migrations…');
  try {
    await migrate(db, { migrationsFolder: 'migrations' });
    console.log('carbon: migrations up to date');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('carbon: migration failed', err);
  process.exit(1);
});
