#!/usr/bin/env node
/**
 * Regenerate `lib/openapi.snapshot.json` from the API's in-process
 * `buildServer` (no live HTTP server required).
 *
 * Usage:
 *   pnpm --filter @carbon/dashboard codegen:api:local
 *
 * This script uses `tsx` to load TypeScript sources from `@carbon/api`.
 * If `tsx` isn't available, run `pnpm add -D tsx` in this workspace first.
 *
 * After the snapshot is written, `codegen:api:from-file` runs
 * `openapi-typescript` on it to update `lib/api-types.gen.ts`.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');
const apiDir = resolve(repoRoot, 'apps', 'api');
const snapshotPath = resolve(__dirname, 'openapi.snapshot.json');

// Small runner: boot the API in-process and inject GET /openapi.json.
const runnerSource = `
import { NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { buildServer } from '${resolve(apiDir, 'src', 'server.ts').replaceAll('\\\\', '/')}';
import { writeFileSync } from 'node:fs';

function makeCtx() {
  return {
    logger: NoopLogger,
    db: {
      execute: async () => [],
      select: () => {
        const chain = {};
        chain.from = () => chain;
        chain.innerJoin = () => chain;
        chain.where = () => chain;
        chain.limit = async () => [];
        chain.then = (resolve) => Promise.resolve([]).then(resolve);
        return chain;
      },
    },
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) },
    emulators: { list: () => [] },
  };
}

const app = await buildServer(makeCtx(), NoopLogger, { publicDocs: true });
await app.ready();
const res = await app.inject('/openapi.json');
writeFileSync(process.argv[2], res.body);
await app.close();
`;

if (!existsSync(apiDir)) {
  console.error(`[openapi] cannot locate apps/api at ${apiDir}`);
  process.exit(1);
}

const runnerFile = resolve(apiDir, '.openapi-runner.mjs');
writeFileSync(runnerFile, runnerSource);
try {
  const result = spawnSync('npx', ['tsx', runnerFile, snapshotPath], {
    cwd: apiDir,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`[openapi] runner failed with status ${result.status}`);
    process.exit(result.status ?? 1);
  }
  console.log(`[openapi] wrote ${snapshotPath}`);
} finally {
  try {
    // Best-effort cleanup.
    // eslint-disable-next-line no-empty
    const { rmSync } = await import('node:fs');
    rmSync(runnerFile, { force: true });
  } catch {
    /* ignore */
  }
}
