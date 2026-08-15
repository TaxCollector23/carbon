import { defineCommand } from 'citty';
import { execSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import pc from 'picocolors';
import {
  DEFAULT_API_URL,
  credentialsPath,
  loadConfig,
  loadCredentials,
  type CarbonConfig,
  type Credentials,
} from '../lib/credentials.js';
import { getPrinter, isJson } from '../lib/printer.js';
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
  args: {
    'api-url': {
      type: 'string',
      description: 'Carbon API base URL to check.',
    },
    'skip-network': {
      type: 'boolean',
      description: 'Skip the API reachability probe.',
    },
  },
  async run({ args }) {
    const config = await readConfig();
    const credentials = await readCredentials();
    const apiUrl = resolveDoctorApiUrl(
      args['api-url'] as string | undefined,
      credentials.value,
      config.value,
    );

    const checks: Check[] = [];
    checks.push(checkNode());
    checks.push(checkPnpm());
    if (config.error) checks.push(loadErrorCheck('Carbon config', config.error));
    if (credentials.error) checks.push(loadErrorCheck('Saved credentials', credentials.error));
    checks.push(checkCredentials(credentials.value, apiUrl));
    const apiBase = checkApiBase(apiUrl);
    checks.push(apiBase);
    for (const target of LOCAL_PORTS) {
      checks.push(await checkPort(target.port, target.name));
    }
    checks.push(checkUrl('DATABASE_URL'));
    checks.push(checkUrl('REDIS_URL'));
    checks.push(checkNodeModulesStaleness());
    checks.push(checkDocker());
    if (!args['skip-network'] && apiBase.status !== 'fail') {
      checks.push(await checkApiReachability(apiUrl));
    }

    if (isJson()) printJson(checks);
    else printTable(checks);
    const failed = checks.filter((c) => c.status === 'fail').length;
    if (failed > 0) process.exitCode = 1;
  },
});

const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 13;

const LOCAL_PORTS = [
  { port: 1223, name: 'Web dev port 1223' },
  { port: 3001, name: 'Dashboard dev port 3001' },
  { port: 4000, name: 'API dev port 4000' },
] as const;

function checkNode(): Check {
  const raw = process.versions.node;
  const [major = 0, minor = 0] = raw.split('.').map((part) => Number(part));
  const supported = major > MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR);
  return {
    name: 'Node.js >= 22.13',
    status: supported ? 'ok' : 'fail',
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

async function checkPort(port: number, name = `Port ${port} free`): Promise<Check> {
  const free = await new Promise<boolean>((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, '127.0.0.1');
  });
  return {
    name,
    status: free ? 'ok' : 'warn',
    detail: free ? 'available' : 'in use',
  };
}

interface LoadResult<T> {
  readonly value: T | null;
  readonly error?: Error;
}

async function readConfig(): Promise<LoadResult<CarbonConfig>> {
  try {
    return { value: await loadConfig() };
  } catch (err) {
    return { value: null, error: err as Error };
  }
}

async function readCredentials(): Promise<LoadResult<Credentials>> {
  try {
    return { value: await loadCredentials() };
  } catch (err) {
    return { value: null, error: err as Error };
  }
}

function loadErrorCheck(name: string, err: Error): Check {
  return {
    name,
    status: 'fail',
    detail: err.message,
  };
}

function resolveDoctorApiUrl(
  flag: string | undefined,
  credentials: Credentials | null,
  config: CarbonConfig | null,
): string {
  return (flag ?? credentials?.apiUrl ?? config?.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
}

function checkCredentials(credentials: Credentials | null, apiUrl: string): Check {
  if (!credentials) {
    return {
      name: 'Saved credentials',
      status: 'warn',
      detail: `not found at ${credentialsPath()} — run carbon login`,
    };
  }

  const savedApiUrl = credentials.apiUrl.replace(/\/+$/, '');
  const key = credentials.keyPrefix ? credentials.keyPrefix : credentials.key.slice(0, 20);
  if (savedApiUrl !== apiUrl) {
    return {
      name: 'Saved credentials',
      status: 'warn',
      detail: `${key} saved for ${savedApiUrl}; probing ${apiUrl}`,
    };
  }

  return {
    name: 'Saved credentials',
    status: 'ok',
    detail: `${key} saved for ${savedApiUrl}`,
  };
}

function checkApiBase(apiUrl: string): Check {
  try {
    // eslint-disable-next-line no-new
    new URL(apiUrl);
    return { name: 'Carbon API URL', status: 'ok', detail: apiUrl };
  } catch {
    return { name: 'Carbon API URL', status: 'fail', detail: `invalid URL: ${apiUrl}` };
  }
}

async function checkApiReachability(apiUrl: string): Promise<Check> {
  const url = `${apiUrl}/v1/version`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.ok) {
      const version = await readVersion(res);
      return {
        name: 'Carbon API reachable',
        status: 'ok',
        detail: version ? `${apiUrl} (${version})` : apiUrl,
      };
    }
    return {
      name: 'Carbon API reachable',
      status: 'warn',
      detail: `${url} returned HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      name: 'Carbon API reachable',
      status: 'warn',
      detail: `${apiUrl} not reachable (${(err as Error).message})`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readVersion(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { version?: unknown; release?: unknown };
    const version = typeof body.version === 'string' ? body.version : body.release;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
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

function printJson(checks: readonly Check[]): void {
  const failed = checks.filter((c) => c.status === 'fail').length;
  const warnings = checks.filter((c) => c.status === 'warn').length;
  getPrinter().emit({
    event: 'doctor.result',
    level: failed > 0 ? 'error' : warnings > 0 ? 'warn' : 'success',
    data: {
      ok: failed === 0,
      failed,
      warnings,
      checks,
    },
  });
}
