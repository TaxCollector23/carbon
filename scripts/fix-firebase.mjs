#!/usr/bin/env node
/**
 * One-shot Firebase Auth setup for the Carbon project.
 *
 * What it does, in order:
 *   1. Runs `npx firebase-tools login --reauth` so the current shell has fresh
 *      OAuth credentials scoped to a Google account that owns the project.
 *   2. Reads the resulting refresh token out of `~/.config/configstore/firebase-tools.json`,
 *      exchanges it for a short-lived access token.
 *   3. Enables the Google sign-in provider on the project (create if missing,
 *      otherwise flip `enabled: true`).
 *   4. Sets the project's authorized domains to include localhost and every
 *      deployed frontend origin passed in.
 *
 * The client id/secret below are the firebase-tools CLI's own OAuth client —
 * these are baked into the open-source CLI and are safe to reuse for the
 * same token-exchange endpoint the CLI itself uses.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const PROJECT_ID = process.env.CARBON_FIREBASE_PROJECT_ID ?? 'carbon-e24f8';
const DOMAINS = (
  process.env.CARBON_FIREBASE_AUTHORIZED_DOMAINS ??
  'localhost,carbon-e24f8.firebaseapp.com,carbon-e24f8.web.app,carbon-web-psi.vercel.app'
)
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean);

const FIREBASE_TOOLS_CLIENT_ID =
  '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FIREBASE_TOOLS_CLIENT_SECRET = 'j9iVZndLrIL7_1fENEH6DhP2';

function step(label) {
  process.stdout.write(`\n\x1b[1;36m› ${label}\x1b[0m\n`);
}
function ok(label) {
  process.stdout.write(`  \x1b[32m✓\x1b[0m ${label}\n`);
}
function fail(label) {
  process.stderr.write(`  \x1b[31m✗\x1b[0m ${label}\n`);
}

async function readAccessToken() {
  const rel =
    platform() === 'win32'
      ? join('AppData', 'Roaming', 'configstore', 'firebase-tools.json')
      : join('.config', 'configstore', 'firebase-tools.json');
  const configPath = join(homedir(), rel);
  if (!existsSync(configPath)) {
    throw new Error(
      `firebase-tools config not found at ${configPath}. Did the login step complete?`,
    );
  }
  const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
  const refreshToken = cfg?.tokens?.refresh_token;
  if (!refreshToken) throw new Error('No refresh_token in firebase-tools config; try login again.');

  const body = new URLSearchParams({
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    client_id: FIREBASE_TOOLS_CLIENT_ID,
    client_secret: FIREBASE_TOOLS_CLIENT_SECRET,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error('No access_token from token exchange.');
  return json.access_token;
}

async function api(method, path, token, body) {
  const url = `https://identitytoolkit.googleapis.com${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, body: json };
}

async function enableGoogleProvider(token) {
  // Try PATCH first (works when the provider entry already exists, even if
  // disabled). If PATCH 404s or the entry is missing, POST to create it.
  const patch = await api(
    'PATCH',
    `/admin/v2/projects/${PROJECT_ID}/defaultSupportedIdpConfigs/google.com?updateMask=enabled`,
    token,
    { enabled: true },
  );
  if (patch.ok) return ok('Google provider enabled');

  if (patch.status === 404 || patch.status === 400) {
    const post = await api(
      'POST',
      `/admin/v2/projects/${PROJECT_ID}/defaultSupportedIdpConfigs?idpId=google.com`,
      token,
      { enabled: true },
    );
    if (post.ok) return ok('Google provider created + enabled');
    return fail(`Google provider POST failed: ${post.status} ${JSON.stringify(post.body)}`);
  }
  return fail(`Google provider PATCH failed: ${patch.status} ${JSON.stringify(patch.body)}`);
}

async function setAuthorizedDomains(token) {
  // Merge with whatever's already there — we don't want to clobber a domain
  // the operator added by hand. Fetch, union, write back.
  const cur = await api('GET', `/admin/v2/projects/${PROJECT_ID}/config`, token);
  if (!cur.ok) return fail(`Read project config failed: ${cur.status} ${JSON.stringify(cur.body)}`);
  const existing = new Set(cur.body?.authorizedDomains ?? []);
  const merged = new Set([...existing, ...DOMAINS]);
  const list = [...merged];

  const patch = await api(
    'PATCH',
    `/admin/v2/projects/${PROJECT_ID}/config?updateMask=authorizedDomains`,
    token,
    { authorizedDomains: list },
  );
  if (patch.ok) return ok(`Authorized domains: ${list.join(', ')}`);
  return fail(`Set authorized domains failed: ${patch.status} ${JSON.stringify(patch.body)}`);
}

async function main() {
  step('Firebase login (browser will open — pick the Google account that owns the project)');
  const login = spawnSync('npx', ['-y', 'firebase-tools@latest', 'login', '--reauth'], {
    stdio: 'inherit',
  });
  if (login.status !== 0) {
    fail(`firebase login exited with status ${login.status}`);
    process.exit(login.status ?? 1);
  }

  step('Exchanging refresh token for admin access token');
  const token = await readAccessToken();
  ok('Access token acquired');

  step(`Enabling Google provider on project "${PROJECT_ID}"`);
  await enableGoogleProvider(token);

  step(`Adding authorized domains to project "${PROJECT_ID}"`);
  await setAuthorizedDomains(token);

  step('Done. Refresh /dashboard and click Continue with Google.');
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
