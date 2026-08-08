/**
 * cold-start.ts
 *
 * Measures spec-to-first-2xx cold start for Carbon. We spawn the actual CLI
 * binary (`node apps/cli/dist/index.cjs emulate --from <fixture> --port <p>`)
 * as a fresh child process, poll GET /__carbon/health until we get 2xx, and
 * report the elapsed time from spawn to first success.
 *
 * This is the real user path: `pnpm dlx carbon-dev emulate --from spec.json`.
 * No in-process shortcuts.
 */
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { percentile, round } from './lib/ir.js';

const RUNS = Number(process.env.CARBON_BENCH_RUNS ?? 10);
const START_TIMEOUT_MS = Number(process.env.CARBON_BENCH_START_TIMEOUT_MS ?? 30_000);

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..', '..');
  const cliDist = resolve(repoRoot, 'apps', 'cli', 'dist', 'index.cjs');
  const fixture = resolve(repoRoot, 'benchmarks', 'fixtures', 'petstore.openapi.json');

  if (!existsSync(cliDist)) {
    throw new Error(
      `CLI dist not found at ${cliDist}. Build it first: pnpm --filter carbon-dev build`,
    );
  }
  if (!existsSync(fixture)) {
    throw new Error(`Fixture missing: ${fixture}`);
  }

  const runs: Array<{ run: number; port: number; elapsedMs: number }> = [];
  for (let i = 0; i < RUNS; i += 1) {
    const port = await pickFreePort();
    const start = performance.now();
    const child = spawn('node', [cliDist, 'emulate', '--from', fixture, '--port', String(port)], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'production' },
    });

    let stderr = '';
    let stdout = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    try {
      await waitForOk(`http://127.0.0.1:${port}/__carbon/health`, START_TIMEOUT_MS, child);
      const elapsedMs = performance.now() - start;
      runs.push({ run: i, port, elapsedMs });
    } catch (err) {
      if (child.exitCode === null) child.kill('SIGKILL');
      throw new Error(
        `Cold-start run ${i} failed: ${(err as Error).message}\n` +
          `CLI stdout:\n${stdout}\nCLI stderr:\n${stderr}`,
      );
    } finally {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await Promise.race([
          new Promise((resolve) => child.once('exit', resolve)),
          sleep(2000),
        ]);
        if (child.exitCode === null) child.kill('SIGKILL');
      }
    }
  }

  const sorted = runs.map((r) => r.elapsedMs).sort((a, b) => a - b);
  const output = {
    tool: 'carbon',
    demo: 'cold-start',
    generatedAt: new Date().toISOString(),
    node: process.version,
    runs: RUNS,
    method: 'child_process.spawn(node apps/cli/dist/index.cjs emulate ...) -> GET /__carbon/health',
    fixture: 'benchmarks/fixtures/petstore.openapi.json',
    coldStartMs: {
      min: round(sorted[0] ?? 0),
      p50: round(percentile(sorted, 0.5)),
      p95: round(percentile(sorted, 0.95)),
      max: round(sorted[sorted.length - 1] ?? 0),
    },
    samples: runs.map((r) => ({ run: r.run, elapsedMs: round(r.elapsedMs) })),
  };
  console.log(JSON.stringify(output, null, 2));
}

async function waitForOk(url: string, timeoutMs: number, child: import('node:child_process').ChildProcess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`CLI exited early with code ${child.exitCode}`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) {
        await res.arrayBuffer();
        return;
      }
    } catch {
      // not up yet
    }
    await sleep(15);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${url}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function pickFreePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rejectPort);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolvePort(port));
      } else {
        rejectPort(new Error('could not determine free port'));
      }
    });
  });
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
