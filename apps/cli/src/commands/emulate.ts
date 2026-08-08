import { defineCommand } from 'citty';
import { carbon } from '@carbon/sdk';
import { ui } from '../ui.js';

export const emulateCommand = defineCommand({
  meta: { name: 'emulate', description: 'Boot the local deterministic API runtime.' },
  args: {
    from: { type: 'string', description: 'Spec or recording to emulate' },
    port: { type: 'string', description: 'Port to bind', default: '8787' },
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

    let replica = await carbon.emulate({ from, port });
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
