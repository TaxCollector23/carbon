import { defineCommand } from 'citty';
import { carbon } from '@carbon/sdk';
import { ui } from '../ui.js';

export const emulateCommand = defineCommand({
  meta: { name: 'emulate', description: 'Boot the local deterministic API runtime.' },
  args: {
    from: { type: 'string', description: 'Spec or recording to emulate' },
    port: { type: 'string', description: 'Port to bind', default: '8787' },
  },
  async run({ args }) {
    if (!args.from) {
      ui.error('Provide --from <spec|recording>');
      process.exitCode = 1;
      return;
    }
    const replica = await carbon.emulate({
      from: args.from,
      port: Number(args.port),
    });
    ui.success(`Runtime ready at ${ui.code(replica.url)}`);
    ui.step('Health', `${replica.url}/__carbon/health`);
    ui.step('Stop', 'Ctrl+C');
    process.on('SIGINT', async () => {
      await replica.close();
      process.exit(0);
    });
  },
});
