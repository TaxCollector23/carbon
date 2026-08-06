import { defineCommand } from 'citty';
import { ui } from '../ui.js';

export const inspectCommand = defineCommand({
  meta: { name: 'inspect', description: 'Explore the current project\'s behavior graph.' },
  async run() {
    ui.header('Behavior graph');
    ui.step('Nodes', '(pending — inspect UI ships with the dashboard release)');
    ui.step('Edges', '(pending)');
    ui.step('Transitions', '(pending)');
  },
});
