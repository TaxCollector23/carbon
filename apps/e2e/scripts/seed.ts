/**
 * Seed the fixture organization the e2e tests depend on.
 *
 * We use a raw `postgres` client (the same driver `@carbon/database` uses)
 * rather than Drizzle so this script has no dependency on the schema
 * package's build output — migrations have already run when this executes.
 *
 * Idempotent: uses ON CONFLICT DO NOTHING so re-running the seed against an
 * already-seeded DB is a no-op.
 */
import postgres from 'postgres';

const ORG_ID = 'org_test';
const ORG_SLUG = 'e2e-test-org';
const ORG_NAME = 'E2E Test Org';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('seed: DATABASE_URL is required');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  try {
    await sql`
      INSERT INTO organizations (id, slug, name)
      VALUES (${ORG_ID}, ${ORG_SLUG}, ${ORG_NAME})
      ON CONFLICT (id) DO NOTHING
    `;
    console.log(`seed: org ${ORG_ID} present`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('seed: failed', err);
  process.exit(1);
});
