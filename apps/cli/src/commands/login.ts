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

export const loginCommand = defineCommand({
  meta: {
    name: 'login',
    description: 'Save a Carbon API key for account-backed workflows.',
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
  },
  async run({ args }) {
    await ensureCarbonDir();

    const savedConfig = await loadConfig();
    const apiUrl =
      (args['api-url'] as string | undefined) ?? savedConfig?.apiUrl ?? DEFAULT_API_URL;

    let key = (args.key as string | undefined)?.trim();
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
      response = await fetch(verifyUrl, {
        headers: { 'x-carbon-key': key },
      });
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
  },
});
