/**
 * all.ts
 *
 * Runs each bench script in sequence in a fresh child process and writes a
 * combined `benchmarks/results/latest.json`. Each entry contains the script's
 * raw JSON output (or the failure). We deliberately do NOT try to normalize
 * across scripts — each bench prints what it actually measured.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

interface BenchDef {
  key: string;
  script: string;
  nodeArgs?: string[];
  required: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const benchesDir = resolve(repoRoot, 'benchmarks');
const resultsDir = resolve(benchesDir, 'results');

const BENCHES: BenchDef[] = [
  { key: 'stateful', script: 'scripts/stateful-consistency.ts', required: true },
  { key: 'snapshot', script: 'scripts/snapshot-restore.ts', required: true },
  {
    key: 'memory',
    script: 'scripts/memory.ts',
    nodeArgs: ['--max-old-space-size=512'],
    required: true,
  },
  { key: 'throughput', script: 'scripts/throughput.ts', required: true },
  { key: 'coldStart', script: 'scripts/cold-start.ts', required: false },
];

function runBench(def: BenchDef): {
  ok: boolean;
  output: unknown;
  stderr: string;
  exitCode: number | null;
} {
  const args = [...(def.nodeArgs ?? []), '--import', 'tsx', resolve(benchesDir, def.script)];
  const res = spawnSync(process.execPath, args, {
    cwd: benchesDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });
  const stdout = res.stdout ?? '';
  const stderr = res.stderr ?? '';
  let parsed: unknown = stdout;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // leave as raw string
  }
  return { ok: res.status === 0, output: parsed, stderr, exitCode: res.status };
}

function main() {
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });

  const cliDist = resolve(repoRoot, 'apps', 'cli', 'dist', 'index.cjs');
  const results: Record<string, unknown> = {};
  let anyRequiredFailed = false;

  for (const def of BENCHES) {
    if (def.key === 'coldStart' && !existsSync(cliDist)) {
      results[def.key] = {
        skipped: true,
        reason: `apps/cli/dist/index.cjs missing — run "pnpm --filter carbon-api build" first`,
      };
      // eslint-disable-next-line no-console
      console.error(`[skip] ${def.key}: CLI not built`);
      continue;
    }
    // eslint-disable-next-line no-console
    console.error(`[run] ${def.key}`);
    const r = runBench(def);
    results[def.key] = r.ok
      ? r.output
      : { failed: true, exitCode: r.exitCode, stderr: r.stderr, output: r.output };
    if (!r.ok) {
      // eslint-disable-next-line no-console
      console.error(`[fail] ${def.key} (exit ${r.exitCode})\n${r.stderr}`);
      if (def.required) anyRequiredFailed = true;
    }
  }

  const combined = {
    tool: 'carbon',
    generatedAt: new Date().toISOString(),
    node: process.version,
    results,
  };
  const outFile = resolve(resultsDir, 'latest.json');
  writeFileSync(outFile, JSON.stringify(combined, null, 2));
  // eslint-disable-next-line no-console
  console.error(`[done] wrote ${outFile}`);
  // Also stream combined JSON to stdout for piping.
  console.log(JSON.stringify(combined, null, 2));

  if (anyRequiredFailed) process.exit(1);
}

main();
