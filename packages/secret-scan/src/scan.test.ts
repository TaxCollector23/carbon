import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scan } from './index.js';

// Assemble fixtures at runtime so the file itself doesn't get flagged by
// GitHub push-protection or by `carbon audit-secrets` running against this
// repo. Same trick used in apps/api/src/plugins/access-log.test.ts.
const SK_LIVE = 'sk' + '_live_' + 'ABCDEFabcdef1234567890XYZ';
const CK_LIVE = 'ck' + '_live_' + 'abcdef123456.SEcReTvAlUe1234567890abcdefghij';
const GH_PAT = 'gh' + 'p_' + 'ABCDEFGHIJKLMNOPQRST0123';
const PG_URL = 'postgres' + '://' + 'u:p@' + 'host:5432/d';

async function seed() {
  const dir = await mkdtemp(join(tmpdir(), 'carbon-secret-scan-'));
  await mkdir(join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, 'node_modules', 'evil'), { recursive: true });

  // Bad file — two hits on different lines.
  await writeFile(
    join(dir, 'src', 'bad.ts'),
    [
      'export const stripe = "' + SK_LIVE + '";',
      'export const carbon = "' + CK_LIVE + '";',
      '',
    ].join('\n'),
  );
  // Bad file inside node_modules — must be ignored by default.
  await writeFile(join(dir, 'node_modules', 'evil', 'leak.js'), 'const x="' + GH_PAT + '";');
  // Config-ish file with an inline DB URL.
  await writeFile(join(dir, 'app.env'), 'DATABASE_URL=' + PG_URL + '\n');
  // Clean file — plausible-looking tokens that shouldn't match.
  await writeFile(
    join(dir, 'src', 'good.ts'),
    ['export const projectId = "prj_abc123";', 'export const commit = "deadbeef";', ''].join('\n'),
  );
  return dir;
}

describe('secret-scan', () => {
  it('flags known-bad content and skips known-good', async () => {
    const dir = await seed();
    const findings = await scan({ paths: ['.'], cwd: dir });

    const paths = findings.map((f) => f.path).sort();
    expect(paths).toEqual(['app.env', 'src/bad.ts', 'src/bad.ts']);

    const kinds = new Set(findings.map((f) => f.kind));
    expect(kinds.has('stripe-secret')).toBe(true);
    expect(kinds.has('carbon-key')).toBe(true);
    expect(kinds.has('db-url-with-password')).toBe(true);

    // The good file produces zero findings.
    expect(findings.every((f) => f.path !== 'src/good.ts')).toBe(true);
  });

  it('honours the default ignore list (node_modules)', async () => {
    const dir = await seed();
    const findings = await scan({ paths: ['.'], cwd: dir });
    expect(findings.every((f) => !f.path.startsWith('node_modules/'))).toBe(true);
  });

  it('reports 1-based line numbers', async () => {
    const dir = await seed();
    const findings = await scan({ paths: ['src/bad.ts'], cwd: dir });
    const stripe = findings.find((f) => f.kind === 'stripe-secret');
    const carbon = findings.find((f) => f.kind === 'carbon-key');
    expect(stripe?.line).toBe(1);
    expect(carbon?.line).toBe(2);
  });

  it('returns [] on a clean tree', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'carbon-secret-scan-clean-'));
    await writeFile(join(dir, 'a.ts'), 'export const ok = 1;\n');
    const findings = await scan({ paths: ['.'], cwd: dir });
    expect(findings).toEqual([]);
  });
});
