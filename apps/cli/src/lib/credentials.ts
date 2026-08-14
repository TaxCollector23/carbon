import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';

export const DEFAULT_API_URL = process.env.CARBON_DEFAULT_API_URL ?? 'http://localhost:4000';
export const CARBON_KEY_PATTERN = /^ck_live_[a-f0-9]{12}\.[A-Za-z0-9_-]{32,128}$/;

export interface Credentials {
  readonly apiUrl: string;
  readonly key: string;
  readonly keyPrefix: string;
  readonly savedAt: string;
}

export interface CarbonConfig {
  readonly apiUrl?: string;
}

export function carbonDir(): string {
  return join(homedir(), '.carbon');
}

export function credentialsPath(): string {
  return join(carbonDir(), 'credentials');
}

export function configPath(): string {
  return join(carbonDir(), 'config.json');
}

export async function ensureCarbonDir(): Promise<void> {
  await mkdir(carbonDir(), { recursive: true, mode: 0o700 });
}

export async function loadCredentials(): Promise<Credentials | null> {
  try {
    const text = await readFile(credentialsPath(), 'utf8');
    const parsed = JSON.parse(text) as Partial<Credentials>;
    if (!parsed.key || !parsed.apiUrl) return null;
    return {
      apiUrl: parsed.apiUrl,
      key: parsed.key,
      keyPrefix: parsed.keyPrefix ?? parsed.key.slice(0, 20),
      savedAt: parsed.savedAt ?? new Date(0).toISOString(),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function loadConfig(): Promise<CarbonConfig | null> {
  try {
    const text = await readFile(configPath(), 'utf8');
    return JSON.parse(text) as CarbonConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function saveCredentials(creds: Credentials): Promise<void> {
  await ensureCarbonDir();
  await writeFile(credentialsPath(), JSON.stringify(creds, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  // If the file already existed with wrong perms, chmod fixes it.
  const s = await stat(credentialsPath());
  if ((s.mode & 0o777) !== 0o600) {
    const { chmod } = await import('node:fs/promises');
    await chmod(credentialsPath(), 0o600);
  }
}

export async function saveConfig(cfg: CarbonConfig): Promise<void> {
  await ensureCarbonDir();
  await writeFile(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
}

export interface ResolveApiKeyOptions {
  readonly flag?: string;
  readonly env?: string;
}

export interface ResolvedApiKey {
  readonly key: string;
  readonly apiUrl: string;
  readonly source: 'flag' | 'env' | 'credentials';
}

/**
 * Resolve an API key from (in order): explicit flag, CARBON_API_KEY env var,
 * saved credentials file. Returns null if nothing is available.
 */
export async function resolveApiKey(
  opts: ResolveApiKeyOptions = {},
  apiUrlFlag?: string,
): Promise<ResolvedApiKey | null> {
  const config = await loadConfig();
  const creds = await loadCredentials();
  const apiUrl = apiUrlFlag ?? creds?.apiUrl ?? config?.apiUrl ?? DEFAULT_API_URL;

  if (opts.flag) {
    return { key: opts.flag, apiUrl, source: 'flag' };
  }
  const envKey = opts.env ?? process.env.CARBON_API_KEY;
  if (envKey) {
    return { key: envKey, apiUrl, source: 'env' };
  }
  if (creds) {
    return { key: creds.key, apiUrl, source: 'credentials' };
  }
  return null;
}
