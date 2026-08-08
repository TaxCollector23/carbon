import { defineCommand } from 'citty';
import { unlink } from 'node:fs/promises';
import { ui } from '../ui.js';
import { credentialsPath, loadCredentials } from '../lib/credentials.js';

/**
 * `carbon logout`
 *
 * Clears the local credentials file and — best-effort — asks the server to
 * revoke the key so a leaked copy cannot be re-used. Revocation is best-effort
 * because the local session is authoritative from the user's perspective: even
 * if the network is down, `logout` must succeed in removing the on-disk key.
 */
export const logoutCommand = defineCommand({
  meta: {
    name: 'logout',
    description: 'Delete the local Carbon credentials and revoke the API key.',
  },
  args: {
    'keep-remote': {
      type: 'boolean',
      description: 'Skip the server-side key revocation step.',
    },
  },
  async run({ args }) {
    const creds = await loadCredentials();
    if (!creds) {
      ui.info('Already signed out — no credentials file to remove.');
      return;
    }

    const keepRemote = Boolean(args['keep-remote']);
    if (!keepRemote) {
      await revokeRemoteKey(creds.apiUrl, creds.key, creds.keyPrefix);
    }

    try {
      await unlink(credentialsPath());
      ui.success('Removed ~/.carbon/credentials');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        ui.info('Credentials file already gone.');
      } else {
        ui.error(`Failed to delete credentials file: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    }
  },
});

async function revokeRemoteKey(apiUrl: string, key: string, prefix: string): Promise<void> {
  const base = apiUrl.replace(/\/+$/, '');
  // Look up the key id via the list endpoint (there's no "revoke by prefix"
  // route). This is best-effort — a warning is enough on failure.
  try {
    const res = await fetch(`${base}/v1/api-keys?limit=200`, {
      headers: { 'x-carbon-key': key },
    });
    if (!res.ok) {
      ui.warn(`Could not list keys to revoke (HTTP ${res.status}); local logout only.`);
      return;
    }
    const payload = (await res.json()) as { data?: Array<{ id: string; prefix: string }> };
    const match = payload.data?.find((row) => row.prefix === prefix);
    if (!match) {
      ui.warn('Could not find this key on the server; local logout only.');
      return;
    }
    const del = await fetch(`${base}/v1/api-keys/${encodeURIComponent(match.id)}`, {
      method: 'DELETE',
      headers: { 'x-carbon-key': key },
    });
    if (del.status === 204 || del.ok) {
      ui.step('Revoked', `${prefix} (server-side)`);
    } else {
      ui.warn(`Server-side revoke returned HTTP ${del.status}; local logout only.`);
    }
  } catch (err) {
    ui.warn(`Server-side revoke failed (${(err as Error).message}); local logout only.`);
  }
}
