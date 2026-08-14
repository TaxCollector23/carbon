import { defineCommand } from 'citty';
import pc from 'picocolors';
import { ui } from '../ui.js';
import { getPrinter, isJson } from '../lib/printer.js';
import { resolveApiKey } from '../lib/credentials.js';
import { EXIT_CONNECTIVITY, EXIT_GENERIC } from '../lib/exit-codes.js';

interface ActivityEvent {
  readonly id: string;
  readonly orgId: string;
  readonly projectId: string | null;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly metadata: unknown;
  readonly createdAt: string;
}

interface ActivityResponse {
  readonly data: readonly ActivityEvent[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * `carbon activity` — mirrors the dashboard's Activity feed. In human mode
 * prints one line per event; in JSON mode emits each event as its own line
 * so streaming pipelines can consume it directly.
 */
export const activityCommand = defineCommand({
  meta: {
    name: 'activity',
    description: 'Show recent org activity (audit log style).',
  },
  args: {
    project: { type: 'string', description: 'Filter by project id.' },
    action: { type: 'string', description: 'Filter by action name (e.g. project.created).' },
    limit: { type: 'string', description: 'Max events to return (default 50).' },
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

    const url = new URL(`${resolved.apiUrl.replace(/\/+$/, '')}/v1/events`);
    if (args.project) url.searchParams.set('projectId', String(args.project));
    if (args.action) url.searchParams.set('action', String(args.action));
    if (args.limit) url.searchParams.set('limit', String(args.limit));

    let res: Response;
    try {
      res = await fetch(url, { headers: { 'x-carbon-key': resolved.key } });
    } catch (err) {
      ui.error(`Could not reach ${url.origin}: ${(err as Error).message}`);
      process.exitCode = EXIT_CONNECTIVITY;
      return;
    }
    if (res.status === 401 || res.status === 403) {
      ui.error('The API rejected your key (read scope required).');
      process.exitCode = EXIT_GENERIC;
      return;
    }
    if (!res.ok) {
      ui.error(`activity failed: HTTP ${res.status}`);
      process.exitCode = EXIT_GENERIC;
      return;
    }
    const body = (await res.json()) as ActivityResponse;

    if (isJson()) {
      for (const evt of body.data) {
        getPrinter().emit({
          event: 'activity',
          level: 'info',
          data: evt as unknown as Record<string, unknown>,
        });
      }
      return;
    }

    ui.header(`Activity — ${body.data.length} event${body.data.length === 1 ? '' : 's'}`);
    if (body.data.length === 0) {
      process.stdout.write(`  ${pc.dim('(no events)')}\n\n`);
      return;
    }
    for (const evt of body.data) {
      const when = new Date(evt.createdAt).toISOString().replace('T', ' ').replace(/\..*$/, '');
      const actor = evt.actorId ?? `<${evt.actorType}>`;
      const summary = summarizeMetadata(evt.metadata);
      process.stdout.write(
        `  ${pc.dim(when)}  ${pc.cyan(actor.padEnd(28))}  ${pc.white(evt.action)}${summary ? `  ${pc.dim(summary)}` : ''}\n`,
      );
    }
    if (body.hasMore) {
      process.stdout.write(
        `\n  ${pc.dim(`… more available (use --limit or a cursor from ${body.nextCursor}).`)}\n`,
      );
    }
    process.stdout.write('\n');
  },
});

function summarizeMetadata(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const entries = Object.entries(meta as Record<string, unknown>);
  if (entries.length === 0) return null;
  return entries
    .slice(0, 3)
    .map(([k, v]) => `${k}=${short(v)}`)
    .join(' ');
}

function short(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 40 ? `${s.slice(0, 37)}…` : s;
}
