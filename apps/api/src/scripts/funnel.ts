import { createDatabase, schema } from '@carbon/database';
import { count, desc, gte, sql } from 'drizzle-orm';

/**
 * Funnel report — one command to see how the marketing launch is doing.
 *
 * Reads the anonymous_events table (populated by POST /v1/track from the
 * landing site) and prints, for the last N days (default 7):
 *
 *   - total events + unique visitors (hashed IPs)
 *   - events per action, newest first (the funnel stages: page views →
 *     CTA clicks → test-drive starts → requests sent)
 *   - top paths the events happened on
 *
 * Run:
 *   DATABASE_URL=postgres://... pnpm --filter @carbon/api tsx src/scripts/funnel.ts [days]
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const days = Number(process.argv[2] ?? 7);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const { db, sql: close } = createDatabase({
    url,
    maxConnections: 1,
    ssl: process.env.NODE_ENV === 'production' ? true : undefined,
  });

  try {
    const total = await db
      .select({ count: count() })
      .from(schema.anonymousEvents)
      .where(gte(schema.anonymousEvents.createdAt, since));
    const visitors = await db
      .select({ count: count(sql`distinct ${schema.anonymousEvents.ipHash}`) })
      .from(schema.anonymousEvents)
      .where(gte(schema.anonymousEvents.createdAt, since));

    const byAction = await db
      .select({
        action: schema.anonymousEvents.action,
        count: count(),
      })
      .from(schema.anonymousEvents)
      .where(gte(schema.anonymousEvents.createdAt, since))
      .groupBy(schema.anonymousEvents.action)
      .orderBy(desc(count()));

    // Raw sql template — postgres-js serializes Date params fine through
    // drizzle's gte(), but not inside a raw fragment, so pass an ISO string.
    const sinceIso = since.toISOString();
    const byPath = await db
      .select({
        path: schema.anonymousEvents.path,
        count: count(),
      })
      .from(schema.anonymousEvents)
      .where(
        sql`${schema.anonymousEvents.createdAt} >= ${sinceIso} AND ${schema.anonymousEvents.path} IS NOT NULL`,
      )
      .groupBy(schema.anonymousEvents.path)
      .orderBy(desc(count()))
      .limit(10);

    const last24h = await db
      .select({ count: count() })
      .from(schema.anonymousEvents)
      .where(gte(schema.anonymousEvents.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));

    console.log(`\nCarbon funnel — last ${days} days (since ${since.toISOString().slice(0, 10)})\n`);
    console.log(`  events       ${total[0]?.count ?? 0}`);
    console.log(`  unique IPs   ${visitors[0]?.count ?? 0}`);
    console.log(`  last 24h     ${last24h[0]?.count ?? 0}\n`);

    console.log('  by action:');
    for (const row of byAction) {
      console.log(`    ${String(row.count).padStart(5)}  ${row.action}`);
    }
    if (byAction.length === 0) console.log('    (no events yet — the tracking endpoint is wired but quiet)');

    console.log('\n  top paths:');
    for (const row of byPath) {
      console.log(`    ${String(row.count).padStart(5)}  ${row.path ?? '(none)'}`);
    }
    if (byPath.length === 0) console.log('    (no paths recorded)');
    console.log('');
  } finally {
    await close.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error('funnel report failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

