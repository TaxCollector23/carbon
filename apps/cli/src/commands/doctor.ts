import { defineCommand } from 'citty';
import { execSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import pc from 'picocolors';
import { ui } from '../ui.js';

type Status = 'ok' | 'warn' | 'fail';
interface Check {
  readonly name: string;
  readonly status: Status;
  readonly detail: string;
}

export const doctorCommand = defineCommand({
  meta: {
    name: 'doctor',
    description: 'Diagnose the local Carbon development environment.',
  },
  async run() {
    const checks: Check[] = [];
    checks.push(checkNode());
    checks.push(checkPnpm());
    for (const port of [3000, 3001, 4000]) {
      checks.push(await checkPort(port));
    }
    checks.push(checkUrl('DATABASE_URL'));
    checks.push(checkUrl('REDIS_URL'));
    checks.push(checkNodeModulesStaleness());
    checks.push(checkDocker());

    printTable(checks);
    const failed = checks.filter((c) => c.status === 'fail').length;
    if (failed > 0) process.exitCode = 1;
  },
});

function checkNode(): Check {
  const raw = process.versions.node;
  const major = Number(raw.split('.')[0]);
  return {
    name: 'Node.js >= 20',
    status: major >= 20 ? 'ok' : 'fail',
    detail: `v${raw}`,
  };
}

function checkPnpm(): Check {
  try {
    const v = execSync('pnpm --version', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return { name: 'pnpm installed', status: 'ok', detail: `v${v}` };
  } catch {
    return { name: 'pnpm installed', status: 'fail', detail: 'not found in PATH' };
  }
}

async function checkPort(port: number): Promise<Check> {
  const free = await new Promise<boolean>((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, '127.0.0.1');
  });
  return {
    name: `Port ${port} free`,
    status: free ? 'ok' : 'warn',
    detail: free ? 'available' : 'in use',
  };
}

function checkUrl(envVar: string): Check {
  const val = process.env[envVar];
  if (!val) return { name: envVar, status: 'warn', detail: 'not set' };
  try {
    // eslint-disable-next-line no-new
    new URL(val);
    return { name: envVar, status: 'ok', detail: 'parseable' };
  } catch {
    return { name: envVar, status: 'fail', detail: 'invalid URL' };
  }
}

function checkNodeModulesStaleness(): Check {
  const cwd = process.cwd();
  try {
    const lock = statSync(join(cwd, 'pnpm-lock.yaml'));
    const mods = statSync(join(cwd, 'node_modules'));
    if (lock.mtimeMs > mods.mtimeMs) {
      return {
        name: 'node_modules fresh',
        status: 'warn',
        detail: 'lockfile newer — run pnpm install',
      };
    }
    return { name: 'node_modules fresh', status: 'ok', detail: 'up to date' };
  } catch {
    return { name: 'node_modules fresh', status: 'warn', detail: 'not found' };
  }
}

function checkDocker(): Check {
  try {
    const v = execSync('docker --version', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return { name: 'Docker available', status: 'ok', detail: v };
  } catch {
    return { name: 'Docker available', status: 'warn', detail: 'not installed (optional)' };
  }
}

function printTable(checks: readonly Check[]): void {
  ui.header('carbon doctor');
  const nameWidth = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) {
    const badge =
      c.status === 'ok'
        ? pc.green('OK  ')
        : c.status === 'warn'
          ? pc.yellow('WARN')
          : pc.red('FAIL');
    const name = c.name.padEnd(nameWidth);
    process.stdout.write(`  ${badge}  ${name}  ${pc.dim(c.detail)}\n`);
  }
  process.stdout.write('\n');
}
