/**
 * Playwright global setup — runs once before any test/webServer boots.
 *
 * We shell out to setup.sh instead of reimplementing createdb + migrate in
 * TypeScript so the same procedure is one-command runnable outside the
 * Playwright harness (useful when debugging a failure locally).
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export default async function globalSetup(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const script = path.join(here, 'setup.sh');
  execFileSync('bash', [script], {
    stdio: 'inherit',
    env: process.env,
  });
}
