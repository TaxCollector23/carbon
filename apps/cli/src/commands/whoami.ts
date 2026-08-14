import { defineCommand } from 'citty';
import pc from 'picocolors';
import { ui } from '../ui.js';
import { DEFAULT_API_URL, loadConfig, loadCredentials } from '../lib/credentials.js';

interface MeResponse {
  user: { id: string; email: string; role: string | null } | null;
  key: { id: string; prefix: string; scopes: string[] } | null;
  org: { id: string; name: string; slug: string } | null;
  plan: string | null;
}

/**
 * `carbon whoami`
 *
 * Prints the identity the current credentials resolve to on the server, so
 * users can tell whether `carbon login` succeeded and against which org.
 */
export const whoamiCommand = defineCommand({
  meta: {
    name: 'whoami',
    description: 'Show the currently authenticated Carbon user, key, and org.',
  },
  args: {
    'api-url': { type: 'string', description: 'Override the API base URL.' },
  },
  async run({ args }) {
    const creds = await loadCredentials();
    const config = await loadConfig();
    const apiUrl = (
      (args['api-url'] as string | undefined) ??
      creds?.apiUrl ??
      config?.apiUrl ??
      DEFAULT_API_URL
    ).replace(/\/+$/, '');

    if (!creds) {
      ui.warn('Not signed in — run `carbon login`.');
      process.exitCode = 1;
      return;
    }

    const url = `${apiUrl}/v1/me`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'x-carbon-key': creds.key } });
    } catch (err) {
      ui.error(`Could not reach ${url}: ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }
    if (res.status === 401 || res.status === 403) {
      ui.error('Your saved key was rejected. Run `carbon login` again.');
      process.exitCode = 1;
      return;
    }
    if (!res.ok) {
      ui.error(`whoami failed: HTTP ${res.status}`);
      process.exitCode = 1;
      return;
    }
    const body = (await res.json()) as MeResponse;

    printTable([
      ['API', apiUrl],
      ['Key', body.key ? `${body.key.prefix} (${body.key.scopes.join(', ')})` : '(none)'],
      [
        'User',
        body.user
          ? `${body.user.email}${body.user.role ? ` — ${body.user.role}` : ''}`
          : '(machine)',
      ],
      ['Org', body.org ? `${body.org.name} (${body.org.slug})` : '(none)'],
      ['Plan', body.plan ?? '(unknown)'],
    ]);
  },
});

function printTable(rows: ReadonlyArray<readonly [string, string]>): void {
  const width = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) {
    process.stdout.write(`  ${pc.dim(k.padEnd(width))}  ${v}\n`);
  }
  process.stdout.write('\n');
}
