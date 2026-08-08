import { defineCommand } from 'citty';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ui } from '../ui.js';
import { resolveApiKey } from '../lib/credentials.js';

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
    push: defineCommand({
      meta: {
        name: 'push',
        description: 'Upload a local snapshot to Carbon Cloud (requires `carbon login`).',
      },
      args: {
        name: { type: 'positional', description: 'Snapshot name (local file)' },
        project: {
          type: 'string',
          description: 'Project slug on the control plane.',
          required: true,
        },
        'api-url': { type: 'string', description: 'Override the control-plane URL.' },
        'api-key': { type: 'string', description: 'Override the saved API key.' },
      },
      async run({ args }) {
        const name = stringArg(args.name);
        const projectSlug = stringArg(args.project);
        if (!name || !projectSlug) {
          ui.error('Usage: carbon snapshot push <name> --project <slug>');
          process.exitCode = 1;
          return;
        }
        const path = join(SNAP_DIR, `${name}.json`);
        if (!existsSync(path)) {
          ui.error(`Local snapshot not found: ${name}`);
          process.exitCode = 1;
          return;
        }
        const resolved = await resolveApiKey(
          { flag: args['api-key'] as string | undefined },
          args['api-url'] as string | undefined,
        );
        if (!resolved) {
          ui.error('No API credentials found. Run `carbon login` first, or pass --api-key.');
          process.exitCode = 1;
          return;
        }
        const snapshot = JSON.parse(await readFile(path, 'utf8'));
        const url = `${resolved.apiUrl.replace(/\/+$/, '')}/v1/snapshots`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-carbon-key': resolved.key,
          },
          body: JSON.stringify({ projectSlug, name, snapshot }),
        });
        if (!res.ok) {
          const body = await res.text();
          ui.error(`Push failed: HTTP ${res.status} ${body}`);
          process.exitCode = 1;
          return;
        }
        const result = (await res.json()) as { storageKey?: string };
        ui.success(`Snapshot ${ui.code(name)} pushed to project ${ui.code(projectSlug)}`);
        if (result.storageKey) ui.step('Key', result.storageKey);
      },
    }),
    pull: defineCommand({
      meta: {
        name: 'pull',
        description: 'Download a snapshot from Carbon Cloud into the local store.',
      },
      args: {
        name: { type: 'positional', description: 'Remote snapshot name' },
        project: {
          type: 'string',
          description: 'Project slug on the control plane.',
          required: true,
        },
        'api-url': { type: 'string', description: 'Override the control-plane URL.' },
        'api-key': { type: 'string', description: 'Override the saved API key.' },
      },
      async run({ args }) {
        const name = stringArg(args.name);
        const projectSlug = stringArg(args.project);
        if (!name || !projectSlug) {
          ui.error('Usage: carbon snapshot pull <name> --project <slug>');
          process.exitCode = 1;
          return;
        }
        const resolved = await resolveApiKey(
          { flag: args['api-key'] as string | undefined },
          args['api-url'] as string | undefined,
        );
        if (!resolved) {
          ui.error('No API credentials found. Run `carbon login` first, or pass --api-key.');
          process.exitCode = 1;
          return;
        }
        const url = `${resolved.apiUrl.replace(/\/+$/, '')}/v1/projects/${encodeURIComponent(projectSlug)}/snapshots/${encodeURIComponent(name)}`;
        const res = await fetch(url, {
          headers: { 'x-carbon-key': resolved.key },
        });
        if (!res.ok) {
          ui.error(`Pull failed: HTTP ${res.status}`);
          process.exitCode = 1;
          return;
        }
        const snapshot = await res.json();
        await ensureDir();
        const path = join(SNAP_DIR, `${name}.json`);
        await writeFile(path, JSON.stringify(snapshot, null, 2), 'utf8');
        ui.success(`Snapshot ${ui.code(name)} pulled from project ${ui.code(projectSlug)}`);
        ui.step('Path', path);
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
