import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema.js';

/**
 * Every request-scoped code path receives the DB via injection. There is no
 * singleton database connection — that would make integration tests fight
 * over the same client. Instead the app boot creates the client once and
 * passes it down.
 */
export type Database = PostgresJsDatabase<typeof schema>;

export interface CreateDatabaseOptions {
  readonly url: string;
  readonly maxConnections?: number;
  /**
   * Prepared statements are faster on direct Postgres connections, but they
   * are not compatible with PgBouncer/Neon pooled transaction mode.
   */
  readonly prepare?: boolean;
  readonly ssl?: boolean;
}

export function createDatabase(opts: CreateDatabaseOptions): { db: Database; sql: Sql } {
  const prepare = opts.prepare ?? shouldPrepareStatements(opts.url);
  const ssl = opts.ssl ?? shouldUseSsl(opts.url);
  const sql = postgres(opts.url, {
    max: opts.maxConnections ?? 10,
    ssl: ssl ? 'require' : false,
    prepare,
  });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

function shouldPrepareStatements(url: string): boolean {
  try {
    const parsed = new URL(url);
    const explicit = parsed.searchParams.get('prepare');
    if (explicit === 'false' || explicit === '0') return false;
    if (explicit === 'true' || explicit === '1') return true;
    if (parsed.searchParams.get('pgbouncer') === 'true') return false;
    return !parsed.hostname.includes('-pooler.');
  } catch {
    return true;
  }
}

function shouldUseSsl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const sslMode = parsed.searchParams.get('sslmode');
    if (sslMode && sslMode !== 'disable') return true;
    return parsed.hostname.endsWith('.neon.tech');
  } catch {
    return false;
  }
}
