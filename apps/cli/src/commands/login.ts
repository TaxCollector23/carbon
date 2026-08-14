import { defineCommand } from 'citty';
import { consola } from 'consola';
import { ui } from '../ui.js';
import {
  CARBON_KEY_PATTERN,
  DEFAULT_API_URL,
  ensureCarbonDir,
  loadConfig,
  saveConfig,
  saveCredentials,
} from '../lib/credentials.js';

/**
 * `carbon login`
 *
 * Two paths:
 *   1. Default — device authorization ("gh auth login" flow). POSTs to the
 *      control plane to open a short-lived session, opens the browser at the
 *      approval URL, then polls until the user approves in the dashboard.
 *      The server reveals the freshly-minted API key exactly once through the
 *      poll response and the CLI writes it to ~/.carbon/credentials.
 *   2. `--key ck_live_…` — legacy scripted path. Unchanged so CI pipelines
 *      that hard-code a key keep working. This path never opens a browser.
 *
 * `--no-browser` prints the URL and skips the browser open (SSH/headless).
 */

const POLL_INTERVAL_MS = 2000;
const POLL_JITTER_MS = 500;

interface StartResponse {
  sessionId: string;
  verifier: string;
  verificationUrl: string;
  expiresAt: string;
}

interface PollResponse {
  status: 'pending' | 'approved' | 'denied' | 'expired';
  key?: string;
}

export const loginCommand = defineCommand({
  meta: {
    name: 'login',
    description: 'Sign in to Carbon via the browser (or --key for scripted use).',
  },
  args: {
    'api-url': {
      type: 'string',
      description: 'Carbon API base URL',
    },
    key: {
      type: 'string',
      description: 'API key (ck_live_...) — for scripted use',
    },
    'no-browser': {
      type: 'boolean',
      description: 'Do not open a browser; print the URL only (SSH/headless).',
    },
  },
  async run({ args }) {
    await ensureCarbonDir();
    const savedConfig = await loadConfig();
    const apiUrl = (
      (args['api-url'] as string | undefined) ??
      savedConfig?.apiUrl ??
      DEFAULT_API_URL
    ).replace(/\/+$/, '');

    const scriptedKey = (args.key as string | undefined)?.trim();
    if (scriptedKey) {
      await legacyKeyFlow(apiUrl, scriptedKey);
      return;
    }

    await deviceAuthFlow(apiUrl, Boolean(args['no-browser']));
  },
});

async function deviceAuthFlow(apiUrl: string, noBrowser: boolean): Promise<void> {
  const startUrl = `${apiUrl}/v1/cli-auth/start`;
  let start: StartResponse;
  try {
    const res = await fetch(startUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) {
      ui.error(`Could not start login: HTTP ${res.status} from ${startUrl}.`);
      process.exitCode = 1;
      return;
    }
    start = (await res.json()) as StartResponse;
  } catch (err) {
    ui.error(
      `Could not reach ${startUrl}: ${(err as Error).message}. Check --api-url or your network.`,
    );
    process.exitCode = 1;
    return;
  }

  ui.header('Sign in to Carbon');
  ui.step('Open', start.verificationUrl);
  ui.step('Code', start.sessionId);
  ui.step('Expires', new Date(start.expiresAt).toLocaleTimeString());

  if (!noBrowser) {
    try {
      const { default: open } = await import('open');
      await open(start.verificationUrl);
    } catch (err) {
      ui.warn(`Could not open a browser automatically: ${(err as Error).message}`);
      ui.info('Open the URL above manually to continue.');
    }
  }

  const key = await pollForApproval(apiUrl, start);
  if (!key) {
    // pollForApproval already surfaced the reason and set exitCode.
    return;
  }

  const keyPrefix = key.slice(0, key.indexOf('.'));
  await saveCredentials({
    apiUrl,
    key,
    keyPrefix,
    savedAt: new Date().toISOString(),
  });
  await saveConfig({ apiUrl });

  ui.success(`Signed in as ${ui.code(keyPrefix)}`);
  ui.step('API', apiUrl);
  ui.step('Saved', '~/.carbon/credentials (mode 0600)');
}

async function pollForApproval(apiUrl: string, start: StartResponse): Promise<string | null> {
  const pollUrl = `${apiUrl}/v1/cli-auth/${encodeURIComponent(
    start.sessionId,
  )}?verifier=${encodeURIComponent(start.verifier)}`;
  const deadline = new Date(start.expiresAt).getTime();
  ui.info('Waiting for approval in the browser…');

  // Jittered polling avoids two CLIs on the same NAT hammering the server on
  // the same tick after a shared network hiccup.
  while (Date.now() < deadline) {
    let res: Response;
    try {
      res = await fetch(pollUrl);
    } catch (err) {
      ui.warn(`Poll failed (${(err as Error).message}); retrying…`);
      await sleep(jitteredInterval());
      continue;
    }

    if (res.status === 410) {
      ui.error('The login session expired. Run `carbon login` again.');
      process.exitCode = 1;
      return null;
    }
    if (res.status === 404) {
      ui.error('The login session is not recognized by the server.');
      process.exitCode = 1;
      return null;
    }
    if (res.status === 429) {
      // Back off harder on rate limit.
      await sleep(jitteredInterval() * 3);
      continue;
    }
    if (!res.ok) {
      ui.warn(`Poll returned HTTP ${res.status}; retrying…`);
      await sleep(jitteredInterval());
      continue;
    }

    const body = (await res.json()) as PollResponse;
    if (body.status === 'approved') {
      if (!body.key) {
        ui.error(
          'Server approved the session but did not return a key — please run `carbon login` again.',
        );
        process.exitCode = 1;
        return null;
      }
      return body.key;
    }
    if (body.status === 'denied') {
      ui.error('The login request was denied in the browser.');
      process.exitCode = 1;
      return null;
    }
    if (body.status === 'expired') {
      ui.error('The login session expired. Run `carbon login` again.');
      process.exitCode = 1;
      return null;
    }
    // status === 'pending' → keep waiting.
    await sleep(jitteredInterval());
  }
  ui.error('Timed out waiting for approval. Run `carbon login` again.');
  process.exitCode = 1;
  return null;
}

function jitteredInterval(): number {
  return POLL_INTERVAL_MS + Math.floor(Math.random() * POLL_JITTER_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Legacy scripted `--key` path (unchanged behavior) ------------------------
async function legacyKeyFlow(apiUrl: string, initialKey?: string): Promise<void> {
  let key = initialKey?.trim();
  if (!key) {
    const answer = await consola.prompt(
      'Paste your Carbon API key (dashboard → API keys, format ck_live_...):',
      { type: 'text', cancel: 'reject' },
    );
    key = typeof answer === 'string' ? answer.trim() : '';
  }

  if (!key) {
    ui.error('No API key provided.');
    process.exitCode = 1;
    return;
  }
  if (!CARBON_KEY_PATTERN.test(key)) {
    ui.error(
      'That does not look like a Carbon API key. Expected format: ck_live_<12 hex>.<32-128 chars>',
    );
    process.exitCode = 1;
    return;
  }

  const verifyUrl = `${apiUrl.replace(/\/+$/, '')}/v1/version`;
  let response: Response;
  try {
    response = await fetch(verifyUrl, { headers: { 'x-carbon-key': key } });
  } catch (err) {
    ui.error(
      `Could not reach ${verifyUrl}: ${(err as Error).message}. Check --api-url or your network.`,
    );
    process.exitCode = 1;
    return;
  }
  if (response.status === 401 || response.status === 403) {
    ui.error('The API rejected that key (401/403). Double-check it and try again.');
    process.exitCode = 1;
    return;
  }
  if (!response.ok) {
    ui.error(`Verification failed: HTTP ${response.status} from ${verifyUrl}.`);
    process.exitCode = 1;
    return;
  }

  const keyPrefix = key.slice(0, key.indexOf('.'));
  await saveCredentials({
    apiUrl,
    key,
    keyPrefix,
    savedAt: new Date().toISOString(),
  });
  await saveConfig({ apiUrl });

  ui.success(`Signed in as ${ui.code(keyPrefix)}`);
  ui.step('API', apiUrl);
  ui.step('Saved', '~/.carbon/credentials (mode 0600)');
}
