import { defineCommand } from 'citty';
import { createServer } from 'node:net';
import { carbon } from '@carbon/sdk';
import { ui } from '../ui.js';

// Boot takes < 1s on a warm cache but can spike to 10s+ on a cold Node
// process behind AV / spotlight indexing. Hard-cap the wait so we never leave
// the user staring at a blinking cursor.
const BOOT_TIMEOUT_MS = 20_000;

async function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

export const emulateCommand = defineCommand({
  meta: { name: 'emulate', description: 'Boot the local deterministic API runtime.' },
  args: {
    from: { type: 'string', description: 'Spec or recording to emulate' },
    port: { type: 'string', description: 'Port to bind', default: '8787' },
    host: { type: 'string', description: 'Host to bind', default: '127.0.0.1' },
    watch: {
      type: 'boolean',
      description: 'Watch the source spec and reload the runtime on change.',
      default: false,
    },
  },
  async run({ args }) {
    if (!args.from) {
      ui.error('Provide --from <spec|recording>');
      process.exitCode = 1;
      return;
    }
    const from = String(args.from);
    const port = Number(args.port);
    const host = String(args.host);

    // Preflight: fast, actionable error instead of a Fastify listen crash
    // deep in the pipeline (which was the "sometimes doesn't load" symptom
    // — the CLI printed nothing because SDK boot threw after our success
    // line had already been queued).
    if (!(await isPortFree(port, host))) {
      ui.error(`Port ${host}:${port} is already in use. Pass a different --port.`);
      process.exitCode = 1;
      return;
    }

    // Always show *something* immediately so the user knows the CLI is alive
    // even on a cold-boot 5+ second parse.
    ui.info(`Starting emulator from ${from}…`);

    let replica: Awaited<ReturnType<typeof carbon.emulate>>;
    try {
      replica = await Promise.race([
        carbon.emulate({ from, port, host }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Emulator boot exceeded ${Math.round(BOOT_TIMEOUT_MS / 1000)}s — the spec parser or runtime is stuck. Run \`carbon doctor\` and try again.`,
                ),
              ),
            BOOT_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch (err) {
      ui.error(`Failed to start emulator: ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }

    ui.success(`Runtime ready at ${ui.code(replica.url)}`);
    ui.step('Health', `${replica.url}/__carbon/health`);
    ui.step('Stop', 'Ctrl+C');

    let watcherClose: (() => Promise<void>) | null = null;

    if (args.watch) {
      // Lazy-load chokidar so the extra dependency only spins up when the
      // user actually asks for watch mode. Debounce reloads to a single
      // trailing rebuild — noisy editors trigger many change events per save.
      const { default: chokidar } = await import('chokidar');
      const watcher = chokidar.watch(from, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 30 },
      });
      let reloading = false;
      let pending = false;
      const doReload = async (): Promise<void> => {
        if (reloading) {
          pending = true;
          return;
        }
        reloading = true;
        try {
          ui.info('[watch] reloading…');
          await replica.close();
          replica = await carbon.emulate({ from, port });
          ui.success(`Runtime ready at ${ui.code(replica.url)}`);
        } catch (err) {
          ui.error(`[watch] reload failed: ${(err as Error).message}`);
        } finally {
          reloading = false;
          if (pending) {
            pending = false;
            void doReload();
          }
        }
      };
      watcher.on('change', () => void doReload());
      watcher.on('add', () => void doReload());
      watcher.on('unlink', () => void doReload());
      ui.step('Watch', from);
      watcherClose = () => watcher.close();
    }

    process.on('SIGINT', async () => {
      try {
        if (watcherClose) await watcherClose();
      } catch {
        // ignore — we're exiting anyway
      }
      await replica.close();
      process.exit(0);
    });
  },
});
