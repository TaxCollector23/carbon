import { defineCommand } from 'citty';
import { ui } from '../ui.js';

export const recordCommand = defineCommand({
  meta: { name: 'record', description: 'Observe live traffic against an upstream API.' },
  args: {
    target: { type: 'positional', description: 'Upstream base URL' },
    port: { type: 'string', description: 'Local proxy port', default: '8788' },
  },
  async run({ args }) {
    ui.header('Recording session');
    ui.step('Target', args.target);
    ui.step('Proxy', `http://127.0.0.1:${args.port}`);
    ui.warn('The recording proxy will land in the next milestone.');
  },
});
