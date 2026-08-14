import { defineCommand } from 'citty';
import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import pc from 'picocolors';
import { ui } from '../ui.js';
import { getPrinter, isJson } from '../lib/printer.js';
import { resolveApiKey } from '../lib/credentials.js';
import { EXIT_CONNECTIVITY, EXIT_GENERIC } from '../lib/exit-codes.js';

const VALID_INCLUDES = [
  'events',
  'projects',
  'snapshots',
  'api_keys',
  'members',
  'ai_quality',
  'usage',
  'audit',
] as const;

/**
 * `carbon export` — the CLI mirror of the Enterprise compliance export.
 * Calls the admin-only `/v1/export` endpoint and streams the response to
 * disk. Default is a JSON bundle; `--format zip` produces a real .zip with
 * one JSON file per include plus a manifest.
 */
export const exportCommand = defineCommand({
  meta: {
    name: 'export',
    description: 'Download a compliance export bundle for the current org.',
  },
  args: {
    include: {
      type: 'string',
      description:
        'Comma-separated include list (events,projects,snapshots,api_keys,members,ai_quality,usage,audit). Default: all.',
    },
    since: { type: 'string', description: 'ISO-8601 start of the window (default: 90 days ago).' },
    until: { type: 'string', description: 'ISO-8601 end of the window (default: now).' },
    format: { type: 'string', description: 'json (default) or zip.' },
    out: {
      type: 'string',
      description: 'Output file path. Default: carbon-export-<orgId>-<epoch>.<ext>.',
    },
    'api-url': { type: 'string', description: 'Override the API base URL.' },
    'api-key': { type: 'string', description: 'API key (defaults to ~/.carbon/credentials).' },
  },
  async run({ args }) {
    const resolved = await resolveApiKey(
      { flag: args['api-key'] as string | undefined },
      args['api-url'] as string | undefined,
    );
    if (!resolved) {
      ui.error('No API credentials found. Run `carbon login` first, or pass --api-key.');
      process.exitCode = EXIT_GENERIC;
      return;
    }

    const format = normalizeFormat(args.format);
    if (!format) {
      ui.error('--format must be either `json` or `zip`.');
      process.exitCode = EXIT_GENERIC;
      return;
    }

    const include = parseInclude(args.include);
    if (include === 'invalid') {
      ui.error(`--include contains an unknown item. Valid: ${VALID_INCLUDES.join(', ')}`);
      process.exitCode = EXIT_GENERIC;
      return;
    }

    const body: Record<string, unknown> = { format };
    if (include && include.length > 0) body.include = include;
    if (args.since) body.since = String(args.since);
    if (args.until) body.until = String(args.until);

    const url = `${resolved.apiUrl.replace(/\/+$/, '')}/v1/export`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'x-carbon-key': resolved.key,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      ui.error(`Could not reach ${new URL(url).origin}: ${(err as Error).message}`);
      process.exitCode = EXIT_CONNECTIVITY;
      return;
    }

    if (res.status === 401 || res.status === 403) {
      ui.error('The API rejected your key (admin scope required for /v1/export).');
      process.exitCode = EXIT_GENERIC;
      return;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      ui.error(`export failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
      process.exitCode = EXIT_GENERIC;
      return;
    }

    const ext = format === 'zip' ? 'zip' : 'json';
    const orgHint = pickOrgHintFromDisposition(res.headers.get('content-disposition')) ?? 'org';
    const outPath =
      (args.out as string | undefined) ?? `carbon-export-${orgHint}-${Date.now()}.${ext}`;

    // Stream the body to disk so large exports never balloon into a single
    // string in memory. `res.body` is a WHATWG ReadableStream; Node accepts
    // it via `Readable.fromWeb`.
    if (!res.body) {
      ui.error('Empty response body from server.');
      process.exitCode = EXIT_GENERIC;
      return;
    }
    const nodeStream = Readable.fromWeb(
      res.body as unknown as import('node:stream/web').ReadableStream,
    );
    const fileStream = createWriteStream(outPath);
    try {
      await pipeline(nodeStream, fileStream);
    } catch (err) {
      ui.error(`failed writing ${outPath}: ${(err as Error).message}`);
      process.exitCode = EXIT_GENERIC;
      return;
    }

    const info = await stat(outPath);
    if (isJson()) {
      getPrinter().emit({
        event: 'export',
        level: 'info',
        data: { path: outPath, bytes: info.size, format },
      });
      return;
    }
    process.stdout.write(
      `${pc.green('✔')} wrote ${formatBytes(info.size)} to ${pc.cyan(outPath)}\n`,
    );
  },
});

function normalizeFormat(v: unknown): 'json' | 'zip' | null {
  if (v === undefined || v === null || v === '') return 'json';
  if (v === 'json' || v === 'zip') return v;
  return null;
}

function parseInclude(v: unknown): readonly string[] | null | 'invalid' {
  if (v === undefined || v === null || v === '') return null;
  const items = String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const it of items) {
    if (!(VALID_INCLUDES as readonly string[]).includes(it)) return 'invalid';
  }
  return items;
}

function pickOrgHintFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  // Server sets `attachment; filename="carbon-export-<orgId>-<epoch>.<ext>"`.
  // Pull the orgId out so the local filename matches without a second round-trip.
  const match = /carbon-export-([^-]+)-\d+\./.exec(disposition);
  return match ? (match[1] ?? null) : null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
