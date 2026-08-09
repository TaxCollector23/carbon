import { defineCommand } from 'citty';
import pc from 'picocolors';
import { ui } from '../ui.js';
import { getPrinter, isJson } from '../lib/printer.js';
import { resolveApiKey } from '../lib/credentials.js';
import { EXIT_CONNECTIVITY, EXIT_GENERIC } from '../lib/exit-codes.js';

interface UsageTotal {
  readonly kind: string;
  readonly total: number;
}
interface UsageResponse {
  readonly orgId?: string;
  readonly since: string;
  readonly until: string;
  readonly totals: readonly UsageTotal[];
}

/**
 * `carbon usage` — the CLI mirror of the dashboard's Billing → Usage view.
 * Talks to the admin-only `/v1/usage` endpoint, so the resolved key needs
 * the `admin` scope.
 */
export const usageCommand = defineCommand({
  meta: {
    name: 'usage',
    description: 'Show metered usage totals for the current org.',
  },
  args: {
    kind: { type: 'string', description: 'Restrict to a single usage kind (e.g. ai_call).' },
    since: { type: 'string', description: 'ISO-8601 start of the window.' },
    until: { type: 'string', description: 'ISO-8601 end of the window.' },
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

    const url = new URL(`${resolved.apiUrl.replace(/\/+$/, '')}/v1/usage`);
    if (args.kind) url.searchParams.set('kind', String(args.kind));
    if (args.since) url.searchParams.set('since', String(args.since));
    if (args.until) url.searchParams.set('until', String(args.until));

    let res: Response;
    try {
      res = await fetch(url, { headers: { 'x-carbon-key': resolved.key } });
    } catch (err) {
      ui.error(`Could not reach ${url.origin}: ${(err as Error).message}`);
      process.exitCode = EXIT_CONNECTIVITY;
      return;
    }
    if (res.status === 401 || res.status === 403) {
      ui.error('The API rejected your key (admin scope required for /v1/usage).');
      process.exitCode = EXIT_GENERIC;
      return;
    }
    if (!res.ok) {
      ui.error(`usage failed: HTTP ${res.status}`);
      process.exitCode = EXIT_GENERIC;
      return;
    }
    const body = (await res.json()) as UsageResponse;

    if (isJson()) {
      getPrinter().emit({
        event: 'usage',
        level: 'info',
        data: { totals: body.totals, from: body.since, to: body.until },
      });
      return;
    }

    ui.header(`Usage  ${pc.dim(body.since)} → ${pc.dim(body.until)}`);
    if (body.totals.length === 0) {
      process.stdout.write(`  ${pc.dim('(no usage recorded in this window)')}\n\n`);
      return;
    }
    const kindWidth = Math.max(
      4,
      ...body.totals.map((t) => t.kind.length),
    );
    process.stdout.write(
      `  ${pc.dim('KIND'.padEnd(kindWidth))}  ${pc.dim('TOTAL')}\n`,
    );
    for (const t of body.totals) {
      process.stdout.write(
        `  ${pc.white(t.kind.padEnd(kindWidth))}  ${pc.cyan(String(t.total))}\n`,
      );
    }
    process.stdout.write('\n');
  },
});
