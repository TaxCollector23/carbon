import { defineCommand } from 'citty';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import { ui } from '../ui.js';

interface ServiceSpec {
  readonly name: 'api' | 'dashboard' | 'web' | 'docs' | 'workers';
  /** pnpm filter target (workspace name). */
  readonly filter: string;
  /** Script from the filter's package.json. */
  readonly script: string;
  /** Default port; used for the "port already in use" preflight only. */
  readonly port?: number;
  /** ANSI color for the tag prefix in interleaved output. */
  readonly color: (s: string) => string;
}

const SERVICES: readonly ServiceSpec[] = [
  { name: 'api', filter: '@carbon/api', script: 'dev', port: 4000, color: pc.cyan },
  { name: 'dashboard', filter: '@carbon/dashboard', script: 'dev', port: 3001, color: pc.magenta },
  { name: 'web', filter: '@carbon/web', script: 'dev', port: 1223, color: pc.green },
  { name: 'docs', filter: '@carbon/docs', script: 'dev', port: 3002, color: pc.yellow },
  { name: 'workers', filter: '@carbon/workers-runner', script: 'dev', color: pc.blue },
];

export const serveCommand = defineCommand({
  meta: {
    name: 'serve',
    description: 'Boot the local Carbon dev stack (api + dashboard + web + workers) in one terminal.',
  },
  args: {
    only: {
      type: 'string',
      description: 'Comma-separated subset (api,dashboard,web,docs,workers). Default: all except docs.',
    },
    'skip-preflight': {
      type: 'boolean',
      description: 'Skip the port-in-use preflight check.',
      default: false,
    },
  },
  async run({ args }) {
    const wanted = pickServices(typeof args.only === 'string' ? args.only : undefined);
    if (wanted.length === 0) {
      ui.error('No services matched --only. Valid: api, dashboard, web, docs, workers.');
      process.exit(2);
    }

    if (!args['skip-preflight']) {
      const conflicts: Array<{ svc: ServiceSpec; port: number }> = [];
      for (const svc of wanted) {
        if (svc.port !== undefined && !(await isPortFree(svc.port))) {
          conflicts.push({ svc, port: svc.port });
        }
      }
      if (conflicts.length > 0) {
        ui.error('Ports already in use:');
        for (const { svc, port } of conflicts) {
          process.stdout.write(`  ${svc.name}: :${port} — kill the holder or pass --skip-preflight\n`);
        }
        process.exit(3);
      }
    }

    const repoRoot = findRepoRoot();
    if (!repoRoot) {
      ui.error("Couldn't locate the Carbon repo root (looking for a pnpm-workspace.yaml).");
      process.exit(4);
    }

    ui.header('carbon serve');
    for (const svc of wanted) {
      process.stdout.write(
        `  ${svc.color('▶')} ${svc.name.padEnd(10)} ${pc.dim(`pnpm --filter ${svc.filter} ${svc.script}`)}` +
          (svc.port ? pc.dim(`  → :${svc.port}`) : '') +
          '\n',
      );
    }
    process.stdout.write('\n');
    process.stdout.write(
      pc.dim('Ctrl+C shuts every child down. Non-zero exits from any child stop the whole stack.\n\n'),
    );

    const children: Array<{ svc: ServiceSpec; proc: ChildProcess }> = [];
    let shuttingDown = false;

    const shutdown = (signal: NodeJS.Signals | 'exit', code = 0): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      for (const { svc, proc } of children) {
        if (proc.exitCode !== null) continue;
        try {
          proc.kill(signal === 'exit' ? 'SIGTERM' : signal);
        } catch (err) {
          process.stdout.write(pc.dim(`  ${svc.name}: kill failed (${(err as Error).message})\n`));
        }
      }
      // Give children a short grace period to flush stdout, then exit.
      setTimeout(() => process.exit(code), 400).unref();
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    for (const svc of wanted) {
      const proc = spawn('pnpm', ['--filter', svc.filter, svc.script], {
        cwd: repoRoot,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      children.push({ svc, proc });

      const tag = svc.color(`[${svc.name}]`);
      const pipe = (stream: NodeJS.ReadableStream | null, isErr: boolean): void => {
        if (!stream) return;
        let buf = '';
        stream.on('data', (chunk) => {
          buf += chunk.toString();
          let idx: number;
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (line.length > 0) {
              (isErr ? process.stderr : process.stdout).write(`${tag} ${line}\n`);
            }
          }
        });
      };
      pipe(proc.stdout, false);
      pipe(proc.stderr, true);

      proc.on('exit', (code, signal) => {
        if (shuttingDown) return;
        const tail = signal ? `signal ${signal}` : `exit ${code}`;
        process.stdout.write(`${tag} ${pc.red('service stopped')} (${tail}) — tearing the stack down.\n`);
        shutdown('SIGTERM', code ?? 1);
      });
    }
  },
});

function pickServices(only: string | undefined): ServiceSpec[] {
  if (!only) {
    // Default: everything except docs — docs needs a Mintlify auth for
    // most repos and is usually not part of the dev loop.
    return SERVICES.filter((s) => s.name !== 'docs');
  }
  const wanted = new Set(
    only
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
  return SERVICES.filter((s) => wanted.has(s.name));
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, '127.0.0.1');
  });
}

function findRepoRoot(startFrom?: string): string | null {
  let dir = startFrom ?? dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}
