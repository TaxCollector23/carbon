import { defineCommand } from 'citty';
import { ui } from '../ui.js';
import { getPrinter, isJson } from '../lib/printer.js';
import { EXIT_CONNECTIVITY, EXIT_GENERIC } from '../lib/exit-codes.js';
import { DEFAULT_API_URL } from '../lib/credentials.js';

interface CapabilitiesResponse {
  readonly service?: string;
  readonly apiVersion?: string;
  readonly capabilities?: {
    readonly specFormats?: readonly string[];
    readonly statefulRuntime?: boolean;
    readonly snapshots?: boolean;
    readonly asyncIngest?: boolean;
    readonly browserPlayground?: boolean;
  };
  readonly limits?: { readonly ingestBodyBytes?: number; readonly requestTimeoutMs?: number };
  readonly links?: { readonly docs?: string; readonly samples?: string; readonly tryIt?: string };
}

export const capabilitiesCommand = defineCommand({
  meta: {
    name: 'capabilities',
    description: 'Show the public capabilities of a Carbon control plane.',
  },
  args: {
    'api-url': {
      type: 'string',
      description: 'Carbon control-plane URL.',
      default: DEFAULT_API_URL,
    },
  },
  async run({ args }) {
    const base = String(args['api-url'] ?? DEFAULT_API_URL).replace(/\/+$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let response: Response;
    try {
      response = await fetch(`${base}/v1/capabilities`, { signal: controller.signal });
    } catch (err) {
      const detail =
        err instanceof Error && err.name === 'AbortError'
          ? 'timed out after 5s'
          : (err as Error).message;
      ui.error(`Could not reach ${base}: ${detail}`);
      process.exitCode = EXIT_CONNECTIVITY;
      return;
    } finally {
      clearTimeout(timeout);
    }

    const body = (await response.json().catch(() => null)) as CapabilitiesResponse | null;
    if (!response.ok || !body) {
      ui.error(`Capabilities request failed: HTTP ${response.status}`);
      process.exitCode = response.status >= 500 ? EXIT_CONNECTIVITY : EXIT_GENERIC;
      return;
    }

    if (isJson()) {
      getPrinter().emit({
        event: 'capabilities',
        level: 'info',
        data: body as Record<string, unknown>,
      });
      return;
    }
    ui.header(`${body.service ?? 'carbon-api'} ${body.apiVersion ?? ''}`.trim());
    ui.step('Formats', body.capabilities?.specFormats?.join(', ') ?? 'unknown');
    ui.step('Stateful runtime', body.capabilities?.statefulRuntime ? 'yes' : 'no');
    ui.step('Snapshots', body.capabilities?.snapshots ? 'yes' : 'no');
    ui.step('Async ingest', body.capabilities?.asyncIngest ? 'yes' : 'no');
    if (body.links?.tryIt) ui.step('Try it', body.links.tryIt);
  },
});
