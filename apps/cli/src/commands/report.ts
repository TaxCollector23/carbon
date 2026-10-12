import { defineCommand } from 'citty';
import { readFile } from 'node:fs/promises';
import { resolveApiKey } from '../lib/credentials.js';
import { getPrinter, isJson } from '../lib/printer.js';
import { EXIT_CONNECTIVITY, EXIT_GENERIC } from '../lib/exit-codes.js';
import { ui } from '../ui.js';
import { renderReliabilityReport, type ReliabilityCliReport } from './test.js';

export const reportCommand = defineCommand({
  meta: { name: 'report', description: 'Inspect a saved or remote reliability report.' },
  args: {
    file: { type: 'positional', description: 'JSON report path.' },
    id: { type: 'string', description: 'Remote reliability run id.' },
    'api-url': { type: 'string', description: 'Carbon control-plane URL override.' },
    'api-key': { type: 'string', description: 'API key (defaults to saved credentials).' },
  },
  async run({ args }) {
    try {
      let report: unknown;
      if (args.file) {
        report = JSON.parse(await readFile(String(args.file), 'utf8'));
      } else if (args.id) {
        const resolved = await resolveApiKey(
          { flag: args['api-key'] as string | undefined },
          args['api-url'] as string | undefined,
        );
        if (!resolved) {
          ui.error('No API credentials found. Run `carbon login` first, or pass --api-key.');
          process.exitCode = EXIT_CONNECTIVITY;
          return;
        }
        const response = await fetch(
          `${resolved.apiUrl.replace(/\/+$/, '')}/v1/reliability/runs/${encodeURIComponent(String(args.id))}`,
          { headers: { accept: 'application/json', 'x-carbon-key': resolved.key } },
        );
        report = await response.json();
        if (!response.ok) throw new Error((report as { error?: { message?: string } }).error?.message ?? `HTTP ${response.status}`);
      } else {
        ui.error('Pass a JSON report path or `--id <run-id>`.');
        process.exitCode = EXIT_GENERIC;
        return;
      }
      if (isJson()) {
        getPrinter().emit({ event: 'report', level: 'info', data: report as Record<string, unknown> });
      } else {
        renderReliabilityReport(report as ReliabilityCliReport);
      }
    } catch (err) {
      ui.error(`Could not read report: ${(err as Error).message}`);
      process.exitCode = EXIT_GENERIC;
    }
  },
});
