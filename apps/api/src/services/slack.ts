import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

/**
 * Slack access-token encryption for `slack_installations.access_token`.
 *
 * Keys are provisioned by the operator via `SLACK_TOKEN_ENC_KEY` (any string;
 * hashed to 32 bytes with SHA-256). When unset, a random per-process key is
 * generated so dev-mode works out of the box — with a loud warning, because a
 * process restart makes every previously-stored token undecryptable.
 *
 * Wire format for a stored token:
 *   base64( 1-byte version | 12-byte IV | 16-byte tag | ciphertext )
 */

const VERSION_BYTE = 0x01;
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;
let warnedEphemeral = false;

export function slackEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.SLACK_TOKEN_ENC_KEY;
  if (raw && raw.length > 0) {
    cachedKey = createHash('sha256').update(raw, 'utf8').digest();
    return cachedKey;
  }
  if (!warnedEphemeral) {
    // Deliberately console.warn rather than a logger — the module is imported
    // eagerly by routes/slack.ts so a Fastify logger isn't available yet, and
    // this is a one-time boot warning that must survive log-level filters.
    // eslint-disable-next-line no-console
    console.warn(
      '[carbon][slack] SLACK_TOKEN_ENC_KEY is not set — generating an ephemeral ' +
        'per-process key. Any previously stored Slack tokens will be undecryptable ' +
        'after a restart. Do NOT run this way in production.',
    );
    warnedEphemeral = true;
  }
  cachedKey = randomBytes(32);
  return cachedKey;
}

/** Test-only reset. Clears the cached key so a subsequent test can inject its own. */
export function __resetSlackKeyForTests(): void {
  cachedKey = null;
  warnedEphemeral = false;
}

export function encryptSlackToken(plaintext: string): string {
  const key = slackEncryptionKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION_BYTE]), iv, tag, enc]).toString('base64');
}

export function decryptSlackToken(ciphertext: string): string {
  const raw = Buffer.from(ciphertext, 'base64');
  if (raw.length < 1 + IV_LEN + TAG_LEN) {
    throw new Error('Malformed Slack token ciphertext (too short)');
  }
  if (raw[0] !== VERSION_BYTE) {
    throw new Error(`Unsupported Slack token ciphertext version: ${raw[0]}`);
  }
  const iv = raw.subarray(1, 1 + IV_LEN);
  const tag = raw.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const enc = raw.subarray(1 + IV_LEN + TAG_LEN);
  const key = slackEncryptionKey();
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/** Scopes requested during OAuth. Kept in one place so the docs match the code. */
export const SLACK_OAUTH_SCOPES: readonly string[] = [
  'channels:read',
  'chat:write',
  'incoming-webhook',
];

/**
 * Build the Slack install URL. `state` should be a random opaque string the
 * caller keeps in a signed cookie / server-side session and re-checks in the
 * OAuth callback to prevent CSRF.
 */
export function slackInstallUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    scope: (opts.scopes ?? SLACK_OAUTH_SCOPES).join(','),
    redirect_uri: opts.redirectUri,
    state: opts.state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export interface SlackOAuthExchangeResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  bot_user_id?: string;
  app_id?: string;
  team?: { id: string; name: string };
  authed_user?: { id: string };
}

/**
 * Injectable Slack HTTP client — the real one uses `fetch` against
 * https://slack.com/api. Tests supply a stub so no real network calls happen.
 */
export interface SlackApiClient {
  exchangeCode(input: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }): Promise<SlackOAuthExchangeResponse>;
  postMessage(input: {
    token: string;
    channel: string;
    text: string;
    blocks?: unknown[];
  }): Promise<{ ok: boolean; error?: string; ts?: string }>;
  revoke(input: { token: string }): Promise<{ ok: boolean; error?: string; revoked?: boolean }>;
}

export const defaultSlackApi: SlackApiClient = {
  async exchangeCode({ code, clientId, clientSecret, redirectUri }) {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });
    const res = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    return (await res.json()) as SlackOAuthExchangeResponse;
  },
  async postMessage({ token, channel, text, blocks }) {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel, text, blocks }),
    });
    return (await res.json()) as { ok: boolean; error?: string; ts?: string };
  },
  async revoke({ token }) {
    const res = await fetch('https://slack.com/api/auth.revoke', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    return (await res.json()) as { ok: boolean; error?: string; revoked?: boolean };
  },
};
