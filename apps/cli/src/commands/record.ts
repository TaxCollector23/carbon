import { defineCommand } from 'citty';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@carbon/core';
import { HttpRecordingProxy } from '@carbon/proxy';
import { ui } from '../ui.js';

export const recordCommand = defineCommand({
  meta: { name: 'record', description: 'Observe live traffic against an upstream API.' },
  args: {
    target: { type: 'positional', description: 'Upstream base URL' },
    port: { type: 'string', description: 'Local proxy port', default: '8788' },
    out: { type: 'string', description: 'Where to write the recording', default: '.carbon/recordings' },
  },
  async run({ args }) {
    const logger = createLogger({ level: 'info', pretty: true, name: 'record' });
    const proxy = new HttpRecordingProxy();
    const handle = await proxy.start({
      target: args.target,
      port: Number(args.port),
      logger,
      onExchange: (exchange) => {
        ui.step(
          `${exchange.request.method} ${new URL(exchange.request.url).pathname}`,
          `${exchange.response.status} · ${exchange.latencyMs}ms`,
        );
      },
    });

    ui.header('Carbon recorder');
    ui.step('Target', args.target);
    ui.step('Proxy', handle.url);
    ui.step('Recording', handle.recordingId);
    ui.info('Press Ctrl+C to stop and save.');

    await new Promise<void>((resolve) => {
      process.once('SIGINT', () => resolve());
    });

    const recording = await handle.stop();
    const path = join(args.out, `${recording.id}.json`);
    await ensureDir(args.out);
    await writeFile(path, JSON.stringify(recording, null, 2), 'utf8');
    ui.success(`Saved ${recording.exchanges.length} exchanges → ${ui.code(path)}`);
  },
});

async function ensureDir(dir: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
}
