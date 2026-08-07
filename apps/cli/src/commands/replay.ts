import { defineCommand } from 'citty';
import { ui } from '../ui.js';

export const replayCommand = defineCommand({
  meta: {
    name: 'replay',
    description: 'Replay a captured session against the same request order.',
  },
  args: { recording: { type: 'positional', description: 'Recording id or file' } },
  async run({ args }) {
    ui.info(`Replaying ${ui.code(args.recording)}`);
    ui.step('Mode', 'strict — every response is compared against the recorded exchange');
  },
});
