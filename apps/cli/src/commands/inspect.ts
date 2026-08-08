import { defineCommand } from 'citty';
import { ui } from '../ui.js';
import { resolveApiKey } from '../lib/credentials.js';

export const inspectCommand = defineCommand({
  meta: { name: 'inspect', description: "Explore the running runtime's graph and stats." },
  args: {
    runtime: { type: 'string', description: 'Runtime URL', default: 'http://localhost:8787' },
    'api-url': { type: 'string', description: 'Carbon control-plane URL override' },
    'api-key': { type: 'string', description: 'API key (defaults to ~/.carbon/credentials)' },
  },
  async run({ args }) {
    const runtime = (args.runtime as string).replace(/\/+$/, '');
    const needsAuth = !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/)/.test(runtime);

    const resolved = await resolveApiKey(
      { flag: args['api-key'] as string | undefined },
      args['api-url'] as string | undefined,
    );

    if (needsAuth && !resolved) {
      ui.error('No API credentials found. Run `carbon login` first, or pass --api-key.');
      process.exitCode = 1;
      return;
    }

    const headers: Record<string, string> = {};
    if (resolved) headers['x-carbon-key'] = resolved.key;

    try {
      const res = await fetch(`${runtime}/__carbon/inspect`, { headers });
      if (res.status === 401 || res.status === 403) {
        ui.error('Runtime rejected the API key (401/403). Try `carbon login` again.');
        process.exitCode = 1;
        return;
      }
      if (!res.ok) {
        ui.error(`Runtime responded with ${res.status}`);
        process.exitCode = 1;
        return;
      }
      const summary = (await res.json()) as {
        api: { name: string; version: string };
        endpoints: number;
        resources: number;
        relationships: number;
      };
      ui.header(`${summary.api.name} v${summary.api.version}`);
      ui.step('Endpoints', String(summary.endpoints));
      ui.step('Resources', String(summary.resources));
      ui.step('Relationships', String(summary.relationships));
    } catch (err) {
      ui.error(`Could not reach ${runtime}: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  },
});
