/**
 * Drop the e2e database at the end of the run.
 *
 * Skipped when CARBON_E2E_KEEP_DB=1 so a failure can be inspected against
 * the real DB. Also skipped when CARBON_E2E_DB was passed in by the caller
 * (they own its lifecycle).
 */
import { execFileSync } from 'node:child_process';

export default async function globalTeardown(): Promise<void> {
  if (process.env.CARBON_E2E_KEEP_DB === '1') {
    console.log('e2e-teardown: keeping DB (CARBON_E2E_KEEP_DB=1)');
    return;
  }
  if (process.env.CARBON_E2E_DB_CALLER_OWNED === '1') return;

  const db = process.env.CARBON_E2E_DB;
  if (!db) return;

  const user = process.env.CARBON_E2E_PG_USER || process.env.USER || 'postgres';
  const host = process.env.CARBON_E2E_PG_HOST || 'localhost';
  const port = process.env.CARBON_E2E_PG_PORT || '5432';

  try {
    execFileSync('dropdb', ['-h', host, '-p', port, '-U', user, '--if-exists', db], {
      stdio: 'inherit',
    });
  } catch (err) {
    console.warn('e2e-teardown: dropdb failed (leaving DB behind)', err);
  }
}
