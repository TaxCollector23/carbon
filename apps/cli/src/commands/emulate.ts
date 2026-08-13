import { defineCommand } from 'citty';
import { carbon } from '@carbon/sdk';
import { ui } from '../ui.js';
import { isPortFree } from '../lib/net.js';

// Boot takes < 1s on a warm cache but can spike to 10s+ on a cold Node
// process behind AV / spotlight indexing. Hard-cap the wait so we never leave
// the user staring at a blinking cursor.
const BOOT_TIMEOUT_MS = 20_000;

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
    let timeoutHandle: NodeJS.Timeout | null = null;
    try {
      const bootPromise = carbon.emulate({ from, port, host });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () =>
            reject(
              new Error(
                `Emulator boot exceeded ${Math.round(BOOT_TIMEOUT_MS / 1000)}s — the spec parser or runtime is stuck. Run \`carbon doctor\` and try again.`,
              ),
            ),
          BOOT_TIMEOUT_MS,
        );
        // Never keep the event loop alive just for this timer — the loop is
        // driven by whatever Fastify winds up owning.
        timeoutHandle.unref();
      });
      replica = await Promise.race([bootPromise, timeoutPromise]);
      // Success path: cancel the pending timer so it can't fire later.
      if (timeoutHandle) clearTimeout(timeoutHandle);
    } catch (err) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      // If the timeout won the race, carbon.emulate() is still running and
      // may bind the port a moment later. Attach a best-effort .catch to
      // close it if it succeeds, so a phantom Fastify doesn't hold the port
      // (or the event loop) after we've told the user boot failed.
      // We can't `await` here — the process is already exiting — but the
      // handler is attached before we `process.exit`, so Node's event loop
      // gets a chance to run it if the resolve happens quickly.
      const stray = Promise.resolve().then(async () => {
        try {
          const late = (await Promise.race([
            carbon.emulate({ from, port, host }),
            new Promise<null>((r) => setTimeout(() => r(null), 5000).unref()),
          ])) as Awaited<ReturnType<typeof carbon.emulate>> | null;
          if (late) await late.close();
        } catch {
          // Best-effort — if it also fails, we've done all we can.
        }
      });
      void stray;
      ui.error(`Failed to start emulator: ${(err as Error).message}`);
      // Exit hard so a partially-booted Fastify can't keep the process alive.
      process.exit(1);
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
