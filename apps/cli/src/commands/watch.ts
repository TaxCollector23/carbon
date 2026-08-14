import { defineCommand } from 'citty';
import WebSocket from 'ws';
import pc from 'picocolors';
import { ui } from '../ui.js';
import { resolveApiKey } from '../lib/credentials.js';

interface JournalEntry {
  seq: number;
  at: number;
  op: 'create' | 'update' | 'replace' | 'delete';
  resource: string;
  id: string;
}

interface StreamFrame {
  type: 'snapshot' | 'mutation' | 'ping';
  at?: number;
  entries?: JournalEntry[];
  entry?: JournalEntry;
}

export const watchCommand = defineCommand({
  meta: {
    name: 'watch',
    description: "Tail a running emulator's state mutations in real time.",
  },
  args: {
    url: {
      type: 'string',
      description: 'Emulator URL (http[s]://host:port)',
      default: 'http://localhost:8787',
    },
    json: { type: 'boolean', description: 'Emit one JSON line per frame', default: false },
    'api-url': { type: 'string', description: 'Carbon control-plane URL override' },
    'api-key': { type: 'string', description: 'API key (defaults to ~/.carbon/credentials)' },
  },
  async run({ args }) {
    const runtime = (args.url as string).replace(/\/+$/, '');
    const wsUrl = runtime.replace(/^http/, 'ws') + '/__carbon/state/stream';
    const asJson = Boolean(args.json);
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/)/.test(runtime);

    const resolved = await resolveApiKey(
      { flag: args['api-key'] as string | undefined },
      args['api-url'] as string | undefined,
    );
    const headers: Record<string, string> = {};
    if (resolved) headers['x-carbon-key'] = resolved.key;
    if (!isLocal && !resolved) {
      ui.error('No API credentials found. Run `carbon login` first, or pass --api-key.');
      process.exitCode = 1;
      return;
    }

    if (!asJson) ui.header(`Watching ${runtime}`);

    await new Promise<void>((resolve) => {
      const ws = new WebSocket(wsUrl, { headers });

      ws.on('open', () => {
        if (!asJson) ui.step('connected', wsUrl);
      });

      ws.on('message', (buf: WebSocket.RawData) => {
        let frame: StreamFrame;
        try {
          frame = JSON.parse(buf.toString()) as StreamFrame;
        } catch {
          return;
        }
        if (frame.type === 'ping') return;
        if (asJson) {
          process.stdout.write(JSON.stringify(frame) + '\n');
          return;
        }
        if (frame.type === 'snapshot') {
          const n = frame.entries?.length ?? 0;
          ui.step('snapshot', `${n} prior entr${n === 1 ? 'y' : 'ies'}`);
          return;
        }
        if (frame.type === 'mutation' && frame.entry) {
          printMutation(frame.entry);
        }
      });

      ws.on('error', (err) => {
        if (asJson) {
          process.stdout.write(
            JSON.stringify({ type: 'error', message: (err as Error).message }) + '\n',
          );
        } else {
          ui.error(`ws error: ${(err as Error).message}`);
        }
        process.exitCode = 1;
      });

      ws.on('close', (code) => {
        if (!asJson) ui.step('closed', `code=${code}`);
        resolve();
      });

      const onSignal = (): void => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
      process.once('SIGINT', onSignal);
      process.once('SIGTERM', onSignal);
    });
  },
});

function printMutation(entry: JournalEntry): void {
  const color = entry.op === 'create' ? pc.green : entry.op === 'delete' ? pc.red : pc.yellow;
  const stamp = new Date(entry.at).toISOString().slice(11, 23);
  process.stdout.write(
    `${pc.dim(stamp)} ${pc.dim('#' + entry.seq)} ${color(entry.op.padEnd(7))} ${entry.resource} ${pc.dim(entry.id)}\n`,
  );
}
