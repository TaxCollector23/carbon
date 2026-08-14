import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import pc from 'picocolors';

const CACHE_FILE = join(homedir(), '.carbon', 'update-cache.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 800;

interface Cache {
  checkedAt: number;
  latest: string;
}

/**
 * Once-per-24h npm registry ping. Never blocks the CLI: it schedules its work
 * via `setImmediate` and caps the fetch at 800ms. If a newer version is found,
 * a subtle notice is written to stderr so it can't corrupt stdout consumers
 * (json mode / pipes).
 */
export function scheduleUpdateCheck(currentVersion: string): void {
  if (process.env.CARBON_DISABLE_UPDATE_CHECK) return;
  setImmediate(() => {
    void run(currentVersion);
  });
}

async function run(current: string): Promise<void> {
  try {
    const cache = await readCache();
    const now = Date.now();
    let latest: string | null = null;
    if (cache && now - cache.checkedAt < CHECK_INTERVAL_MS) {
      latest = cache.latest;
    } else {
      latest = await fetchLatest();
      if (latest) await writeCache({ checkedAt: now, latest });
    }
    if (latest && semverGreater(latest, current)) {
      process.stderr.write(
        `${pc.dim(`↑ carbon-api ${latest} is available (you have ${current}). Run \`npm i -g carbon-api\` to upgrade.`)}\n`,
      );
    }
  } catch {
    // Non-fatal — never surface update-check errors.
  }
}

async function fetchLatest(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch('https://registry.npmjs.org/carbon-api/latest', {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: string };
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readCache(): Promise<Cache | null> {
  try {
    const text = await readFile(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(text) as Partial<Cache>;
    if (typeof parsed.checkedAt !== 'number' || typeof parsed.latest !== 'string') return null;
    return { checkedAt: parsed.checkedAt, latest: parsed.latest };
  } catch {
    return null;
  }
}

async function writeCache(c: Cache): Promise<void> {
  try {
    await mkdir(join(homedir(), '.carbon'), { recursive: true, mode: 0o700 });
    await writeFile(CACHE_FILE, JSON.stringify(c, null, 2), 'utf8');
  } catch {
    // best-effort
  }
}

/**
 * Minimal semver "greater than" comparison. Strips any pre-release / build
 * suffix — the CLI only cares about stable releases for the update prompt.
 */
export function semverGreater(a: string, b: string): boolean {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

function parse(v: string): [number, number, number] {
  const core = v.replace(/^v/, '').split(/[-+]/)[0] ?? '0.0.0';
  const [maj = '0', min = '0', pat = '0'] = core.split('.');
  return [Number(maj) || 0, Number(min) || 0, Number(pat) || 0];
}
