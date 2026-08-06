import { defineCommand } from 'citty';
import { ui } from '../ui.js';

export const loginCommand = defineCommand({
  meta: { name: 'login', description: 'Authenticate with your Carbon account.' },
  async run() {
    ui.info('Opening browser to carbon.dev/cli/authorize…');
    ui.step('Waiting for confirmation', 'the CLI will exchange a device code');
    ui.warn('Not implemented in this milestone — coming with the dashboard release.');
  },
});
