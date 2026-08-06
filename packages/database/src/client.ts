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
  readonly ssl?: boolean;
}

export function createDatabase(opts: CreateDatabaseOptions): { db: Database; sql: Sql } {
  const sql = postgres(opts.url, {
    max: opts.maxConnections ?? 10,
    ssl: opts.ssl ? 'require' : false,
    prepare: true,
  });
  const db = drizzle(sql, { schema });
  return { db, sql };
}
