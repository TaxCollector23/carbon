import { defineCommand } from 'citty';
import pc from 'picocolors';
import { scan, type Finding } from '@carbon/secret-scan';
import { ui } from '../ui.js';
import { getPrinter, isJson } from '../lib/printer.js';
import { EXIT_GENERIC } from '../lib/exit-codes.js';

/**
 * `carbon audit-secrets [path...]` — offline, no-network scan for well-known
 * secret shapes. Exit code 1 on any finding so both the pre-commit hook
 * (`.githooks/pre-commit`) and CI (`.github/workflows/ci.yml`) can block on
 * it without extra glue.
 *
 * Args are positional file/directory/glob paths. With none, defaults to `.`.
 * `--json` (top-level, stripped by index.ts) switches to one JSON line per
 * finding for scripting.
 */
export const auditSecretsCommand = defineCommand({
  meta: {
    name: 'audit-secrets',
    description: 'Scan the working tree for accidentally-committed secrets.',
  },
  args: {
    _: {
      type: 'positional',
      required: false,
      description: 'Files or directories to scan. Defaults to the current directory.',
    },
  },
  async run({ args }) {
    // Citty puts unnamed positionals on `args._`. Fall back to `.` when the
    // user just runs `carbon audit-secrets`.
    const raw = args._ as unknown;
    const positional = Array.isArray(raw)
      ? (raw as unknown[]).map(String).filter((s) => s.length > 0)
      : typeof raw === 'string' && raw.length > 0
        ? [raw]
        : [];
    const paths = positional.length > 0 ? positional : ['.'];

    const findings = await scan({ paths });

    if (isJson()) {
      const printer = getPrinter();
      for (const f of findings) {
        printer.emit({ event: 'audit-secrets.finding', level: 'error', data: { ...f } });
      }
      printer.emit({
        event: 'audit-secrets.summary',
        level: findings.length > 0 ? 'error' : 'info',
        data: { count: findings.length },
      });
    } else {
      renderTable(findings);
    }

    if (findings.length > 0) process.exitCode = EXIT_GENERIC;
  },
});

function renderTable(findings: readonly Finding[]): void {
  ui.header('carbon audit-secrets');
  if (findings.length === 0) {
    process.stdout.write(`  ${pc.green('OK')}  no secrets detected\n\n`);
    return;
  }

  const rows = findings.map((f) => ({
    kind: f.kind,
    where: `${f.path}:${f.line}`,
    // Never echo the full match — a scanner that leaks the leak is worse
    // than useless. Show a shape-preserving prefix.
    preview: previewMatch(f.match),
  }));
  const kindWidth = Math.max(4, ...rows.map((r) => r.kind.length));
  const whereWidth = Math.max(5, ...rows.map((r) => r.where.length));

  process.stdout.write(
    `  ${pc.bold('KIND'.padEnd(kindWidth))}  ${pc.bold('WHERE'.padEnd(whereWidth))}  ${pc.bold('PREVIEW')}\n`,
  );
  for (const r of rows) {
    process.stdout.write(
      `  ${pc.red(r.kind.padEnd(kindWidth))}  ${r.where.padEnd(whereWidth)}  ${pc.dim(r.preview)}\n`,
    );
  }
  process.stdout.write(
    `\n  ${pc.red(String(findings.length))} finding${findings.length === 1 ? '' : 's'}. Rotate every credential above before pushing.\n\n`,
  );
}

function previewMatch(match: string): string {
  const flat = match.replace(/\s+/g, ' ');
  if (flat.length <= 18) return flat;
  return `${flat.slice(0, 12)}…${flat.slice(-4)}`;
}
