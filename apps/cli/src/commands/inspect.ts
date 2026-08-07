import { defineCommand } from 'citty';
import { ui } from '../ui.js';

export const inspectCommand = defineCommand({
  meta: { name: 'inspect', description: "Explore the running runtime's graph and stats." },
  args: {
    runtime: { type: 'string', description: 'Runtime URL', default: 'http://localhost:8787' },
  },
  async run({ args }) {
    try {
      const res = await fetch(`${args.runtime}/__carbon/inspect`);
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
      ui.error(`Could not reach ${args.runtime}: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  },
});
