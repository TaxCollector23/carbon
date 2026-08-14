import { mkdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CatalogEntry } from '@carbon/catalog';

/**
 * Local cache location for catalog-fetched specs. One file per slug, named
 * with the right extension so tools that sniff by suffix (including the
 * parser's format detector) do the right thing.
 */
const CACHE_ROOT = join(homedir(), '.carbon', 'catalog-cache');
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function extForEntry(entry: CatalogEntry): string {
  if (entry.specFormat === 'graphql') return 'graphql';
  // Trust the URL suffix when it's obvious; otherwise default to .json,
  // which is by far the most common OpenAPI encoding on the web.
  const lower = entry.specUrl.toLowerCase();
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  return 'json';
}

function cachePathFor(entry: CatalogEntry): string {
  return join(CACHE_ROOT, `${entry.slug}.${extForEntry(entry)}`);
}

async function isFresh(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return Date.now() - s.mtimeMs < MAX_AGE_MS;
  } catch {
    return false;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a catalog entry to a local file path suitable for
 * `carbon emulate --from <path>`. Fetches once and re-uses the cache for
 * seven days. GraphQL entries are cached as a tiny descriptor pointing at
 * the introspectable endpoint — the SDK's GraphQL ingest talks to the
 * endpoint directly rather than parsing a file.
 */
export async function resolveCatalogSpec(entry: CatalogEntry): Promise<string> {
  await mkdir(CACHE_ROOT, { recursive: true });
  const path = cachePathFor(entry);

  if (entry.specFormat === 'graphql') {
    // Nothing to download — write a stub the first time so tests can see
    // the cache directory populated, and hand the caller the live URL.
    if (!(await fileExists(path))) {
      await writeFile(path, `# Carbon catalog: ${entry.slug}\n# Live endpoint: ${entry.specUrl}\n`);
    }
    return entry.specUrl;
  }

  if (await isFresh(path)) return path;

  try {
    const res = await fetch(entry.specUrl);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${entry.specUrl}`);
    }
    const body = await res.text();
    await writeFile(path, body);
    return path;
  } catch (err) {
    // Fall back to a stale cache if the network is down — better a slightly
    // out-of-date spec than an unusable CLI.
    if (await fileExists(path)) return path;
    throw err;
  }
}
