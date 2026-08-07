import { defineCommand } from 'citty';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ui } from '../ui.js';

const SNAP_DIR = '.carbon/snapshots';

async function ensureDir(): Promise<void> {
  await mkdir(SNAP_DIR, { recursive: true });
}

export const snapshotCommand = defineCommand({
  meta: { name: 'snapshot', description: 'Manage state snapshots for the current project.' },
  subCommands: {
    save: defineCommand({
      meta: { name: 'save', description: 'Save the current runtime state to a named snapshot.' },
      args: {
        name: { type: 'positional', description: 'Snapshot name' },
        runtime: { type: 'string', description: 'Runtime URL', default: 'http://localhost:8787' },
      },
      async run({ args }) {
        const name = stringArg(args.name);
        const runtime = stringArg(args.runtime) ?? 'http://localhost:8787';
        if (!name) {
          ui.error('Snapshot name is required');
          process.exitCode = 1;
          return;
        }
        await ensureDir();
        try {
          const res = await fetch(`${runtime}/__carbon/state/snapshot`, { method: 'POST' });
          if (!res.ok) throw new Error(`runtime returned ${res.status}`);
          const snapshot = await res.json();
          const path = join(SNAP_DIR, `${name}.json`);
          await writeFile(path, JSON.stringify(snapshot, null, 2), 'utf8');
          ui.success(`Snapshot ${ui.code(name)} saved`);
          ui.step('Path', path);
        } catch (err) {
          ui.error(`Could not reach runtime at ${runtime}: ${(err as Error).message}`);
          ui.step('Hint', 'Start it with `carbon emulate --from <spec>` first');
          process.exitCode = 1;
        }
      },
    }),
    load: defineCommand({
      meta: { name: 'load', description: 'Restore a named snapshot into the runtime.' },
      args: {
        name: { type: 'positional', description: 'Snapshot name' },
        runtime: { type: 'string', description: 'Runtime URL', default: 'http://localhost:8787' },
      },
      async run({ args }) {
        const name = stringArg(args.name);
        const runtime = stringArg(args.runtime) ?? 'http://localhost:8787';
        if (!name) {
          ui.error('Snapshot name is required');
          process.exitCode = 1;
          return;
        }
        const path = join(SNAP_DIR, `${name}.json`);
        if (!existsSync(path)) {
          ui.error(`Unknown snapshot: ${name}`);
          process.exitCode = 1;
          return;
        }
        const snapshot = JSON.parse(await readFile(path, 'utf8'));
        const res = await fetch(`${runtime}/__carbon/state/restore`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(snapshot),
        });
        if (!res.ok) {
          ui.error(`Runtime rejected snapshot: ${res.status}`);
          process.exitCode = 1;
          return;
        }
        ui.success(`Snapshot ${ui.code(name)} restored`);
      },
    }),
    list: defineCommand({
      meta: { name: 'list', description: 'List saved snapshots.' },
      async run() {
        if (!existsSync(SNAP_DIR)) {
          ui.info('No snapshots yet. Save one with `carbon snapshot save <name>`.');
          return;
        }
        const entries = await readdir(SNAP_DIR);
        const rows = entries.filter((e) => e.endsWith('.json'));
        if (rows.length === 0) {
          ui.info('No snapshots yet.');
          return;
        }
        ui.header('Snapshots');
        for (const row of rows) {
          const st = await stat(join(SNAP_DIR, row));
          ui.step(row.replace(/\.json$/, ''), `${st.size}B · ${st.mtime.toISOString()}`);
        }
      },
    }),
    delete: defineCommand({
      meta: { name: 'delete', description: 'Delete a named snapshot.' },
      args: { name: { type: 'positional', description: 'Snapshot name' } },
      async run({ args }) {
        const name = stringArg(args.name);
        if (!name) {
          ui.error('Snapshot name is required');
          process.exitCode = 1;
          return;
        }
        const path = join(SNAP_DIR, `${name}.json`);
        if (!existsSync(path)) {
          ui.error(`Unknown snapshot: ${name}`);
          process.exitCode = 1;
          return;
        }
        await unlink(path);
        ui.success(`Deleted snapshot ${ui.code(name)}`);
      },
    }),
  },
});

function stringArg(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
