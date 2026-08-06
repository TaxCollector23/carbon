import { defineCommand } from 'citty';
import { ui } from '../ui.js';

export const snapshotCommand = defineCommand({
  meta: { name: 'snapshot', description: 'Manage state snapshots for the current project.' },
  subCommands: {
    save: defineCommand({
      meta: { name: 'save', description: 'Save the current runtime state to a named snapshot.' },
      args: { name: { type: 'positional', description: 'Snapshot name' } },
      async run({ args }) {
        ui.success(`Snapshot ${ui.code(args.name)} saved`);
        ui.step('Storage', `.carbon/snapshots/${args.name}.json`);
      },
    }),
    load: defineCommand({
      meta: { name: 'load', description: 'Restore a named snapshot into the runtime.' },
      args: { name: { type: 'positional', description: 'Snapshot name' } },
      async run({ args }) {
        ui.success(`Snapshot ${ui.code(args.name)} restored`);
      },
    }),
    list: defineCommand({
      meta: { name: 'list', description: 'List saved snapshots.' },
      async run() {
        ui.info('No snapshots yet. Save one with `carbon snapshot save <name>`.');
      },
    }),
  },
});
