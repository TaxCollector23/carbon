import { readFile, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import fg from 'fast-glob';
import { SECRET_PATTERNS, type SecretPattern } from './patterns.js';

export { SECRET_PATTERNS, SECRET_VALUE_PATTERNS, type SecretPattern } from './patterns.js';

/**
 * A single hit. `line` is 1-based (editor-friendly). `match` is the raw
 * offending substring — the audit tool truncates it before printing so an
 * accidental log of the finding itself doesn't re-leak.
 */
export interface Finding {
  readonly path: string;
  readonly line: number;
  readonly match: string;
  readonly kind: string;
}

export interface ScanOptions {
  /** Files or globs to scan. Directories are expanded to `**\/*`. */
  readonly paths: readonly string[];
  /** Extra glob ignore patterns. Merged with the defaults. */
  readonly ignore?: readonly string[];
  /** Override the built-in pattern list (used by tests). */
  readonly patterns?: readonly SecretPattern[];
  /** Root for `relative()` normalization. Defaults to process.cwd(). */
  readonly cwd?: string;
  /** Skip files larger than this many bytes. Defaults to 2 MiB. */
  readonly maxFileBytes?: number;
}

/**
 * Directories and file suffixes that would drown the scanner in noise. Not
 * a substitute for `.gitignore` — the pre-commit hook already narrows to
 * staged files. Kept intentionally short so a novel build dir doesn't
 * silently get skipped.
 */
const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/.svelte-kit/**',
  '**/coverage/**',
  '**/*.min.js',
  '**/*.map',
  '**/pnpm-lock.yaml',
  '**/package-lock.json',
  '**/yarn.lock',
  // Example/template files whose whole purpose is to hold placeholder
  // credentials. Real secrets live in `.env`, which we scan.
  '**/.env.example',
  '**/.env.sample',
  '**/.env.template',
];

/**
 * Binary/large-blob extensions we never want to scan. Reading a 40 MB PNG
 * as text is both slow and pointless — no pattern here matches image bytes.
 */
const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.mp4',
  '.mov',
  '.mp3',
  '.wav',
  '.wasm',
]);

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Walk `paths`, match each text line against every pattern, and return every
 * hit. Deterministic order: file path, then line number, then kind. Callers
 * that need to be strict simply check `findings.length === 0`.
 *
 * The scanner deliberately runs off-line and off-process — it never phones
 * home, and the caller supplies the file list so `git diff --cached` output
 * can be piped straight through for the pre-commit hook.
 */
export async function scan(opts: ScanOptions): Promise<Finding[]> {
  const cwd = opts.cwd ?? process.cwd();
  const patterns = opts.patterns ?? SECRET_PATTERNS;
  const maxBytes = opts.maxFileBytes ?? DEFAULT_MAX_BYTES;
  const ignore = [...DEFAULT_IGNORE, ...(opts.ignore ?? [])];

  const files = await expandPaths(opts.paths, cwd, ignore);
  const findings: Finding[] = [];

  for (const abs of files) {
    if (BINARY_EXT.has(extname(abs).toLowerCase())) continue;
    try {
      const s = await stat(abs);
      if (!s.isFile()) continue;
      if (s.size > maxBytes) continue;
    } catch {
      continue;
    }
    let text: string;
    try {
      text = await readFile(abs, 'utf8');
    } catch {
      continue;
    }
    // Fast reject: a file with no `sk`, `ck_`, `xox`, `gh`, `AKIA`, `ASIA`,
    // `BEGIN`, or `://` substring can't match any pattern here. Cheaper than
    // running eight regexes over multi-MB source files.
    if (!QUICK_REJECT.test(text)) continue;

    const rel = relative(cwd, abs) || abs;
    for (const pat of patterns) {
      // Fresh regex per iteration — /g regexes keep lastIndex between calls.
      const re = new RegExp(pat.regex.source, pat.regex.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        findings.push({
          path: rel,
          line: lineNumberFor(text, m.index),
          match: m[0],
          kind: pat.kind,
        });
        // Guard against zero-width matches sending us into an infinite loop.
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
  }

  findings.sort(
    (a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.kind.localeCompare(b.kind),
  );
  return findings;
}

// Substring the file must contain for *any* pattern above to possibly match.
// Keep in lock-step with SECRET_PATTERNS — if a new prefix is added, add it
// here too or the fast-reject will silently hide it.
const QUICK_REJECT =
  /sk[-_]|ck_live_|xox[abpsr]-|gh[pousr]_|AKIA|ASIA|BEGIN[^\n]*PRIVATE KEY|:\/\//;

async function expandPaths(
  paths: readonly string[],
  cwd: string,
  ignore: readonly string[],
): Promise<string[]> {
  const out = new Set<string>();
  // Explicit paths should honour the ignore list too — the pre-commit hook
  // passes staged files directly, bypassing fast-glob's discovery pass.
  // Compile each glob pattern into a match predicate up front. Handles the
  // patterns we actually ship in DEFAULT_IGNORE (**/foo, **/*.bar, **/dir/**);
  // richer glob semantics can be added if a caller needs them.
  const globToRe = (glob: string): RegExp => {
    const re = glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\/?/g, '§§DBLSTAR§§')
      .replace(/\*/g, '[^/]*')
      .replace(/§§DBLSTAR§§/g, '(?:.*/)?');
    return new RegExp(`^${re}$`);
  };
  const ignoreRes = ignore.map(globToRe);
  const shouldIgnore = (absPath: string): boolean => {
    const rel = absPath.startsWith(cwd + '/') ? absPath.slice(cwd.length + 1) : absPath;
    return ignoreRes.some((re) => re.test(absPath) || re.test(rel) || re.test('/' + rel));
  };
  for (const raw of paths) {
    if (!raw) continue;
    const abs = resolve(cwd, raw);
    let isDir = false;
    try {
      const s = await stat(abs);
      if (s.isFile()) {
        if (!shouldIgnore(abs)) out.add(abs);
        continue;
      }
      isDir = s.isDirectory();
    } catch {
      // Not a real path — treat as a glob and let fast-glob decide.
    }
    const glob = isDir ? `${raw.replace(/\/+$/, '')}/**/*` : raw;
    const matches = await fg(glob, {
      cwd,
      absolute: true,
      dot: false,
      onlyFiles: true,
      followSymbolicLinks: false,
      ignore: [...ignore],
    });
    for (const m of matches) out.add(m);
  }
  return [...out].sort();
}

function lineNumberFor(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function extname(p: string): string {
  const i = p.lastIndexOf('.');
  const s = p.lastIndexOf('/');
  return i > s ? p.slice(i) : '';
}
