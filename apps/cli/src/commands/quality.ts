import { defineCommand } from 'citty';
import pc from 'picocolors';
import { ui } from '../ui.js';
import { getPrinter, isJson } from '../lib/printer.js';
import { resolveApiKey } from '../lib/credentials.js';
import { EXIT_ASSERTION_FAILED, EXIT_CONNECTIVITY, EXIT_GENERIC } from '../lib/exit-codes.js';

interface ProjectRow {
  readonly id: string;
  readonly slug: string;
  readonly name?: string;
}
interface ProjectList {
  readonly data: readonly ProjectRow[];
}

interface QualityReport {
  readonly id: string;
  readonly projectId: string;
  readonly resourcesScore: string | null;
  readonly relationshipsScore: string | null;
  readonly minScore: string | null;
  readonly issues: readonly unknown[];
  readonly needsReview: boolean;
  readonly model: string | null;
  readonly createdAt: string;
}

interface QualityHistoryResponse {
  readonly data: readonly QualityReport[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * `carbon quality --project SLUG` — mirrors the AI Quality dashboard tab.
 * With --latest (the default) prints the newest report; without it walks
 * the paginated history endpoint. Exit code 1 when the latest report has
 * `needsReview: true`, so CI can gate deploys on it.
 */
export const qualityCommand = defineCommand({
  meta: {
    name: 'quality',
    description: 'Show AI-quality reports for a project.',
  },
  args: {
    project: { type: 'string', description: 'Project slug (required).', required: true },
    latest: { type: 'boolean', description: 'Show only the latest report (default true).' },
    'api-url': { type: 'string', description: 'Override the API base URL.' },
    'api-key': { type: 'string', description: 'API key (defaults to ~/.carbon/credentials).' },
  },
  async run({ args }) {
    const resolved = await resolveApiKey(
      { flag: args['api-key'] as string | undefined },
      args['api-url'] as string | undefined,
    );
    if (!resolved) {
      ui.error('No API credentials found. Run `carbon login` first, or pass --api-key.');
      process.exitCode = EXIT_GENERIC;
      return;
    }
    const base = resolved.apiUrl.replace(/\/+$/, '');
    const headers = { 'x-carbon-key': resolved.key };
    const slug = String(args.project);

    // Resolve slug → id.
    let projectId: string;
    try {
      const listRes = await fetch(`${base}/v1/projects?limit=200`, { headers });
      if (listRes.status === 401 || listRes.status === 403) {
        ui.error('The API rejected your key.');
        process.exitCode = EXIT_GENERIC;
        return;
      }
      if (!listRes.ok) {
        ui.error(`Could not list projects: HTTP ${listRes.status}`);
        process.exitCode = EXIT_GENERIC;
        return;
      }
      const list = (await listRes.json()) as ProjectList;
      const match = list.data.find((p) => p.slug === slug);
      if (!match) {
        ui.error(`Project not found: ${slug}`);
        process.exitCode = EXIT_GENERIC;
        return;
      }
      projectId = match.id;
    } catch (err) {
      ui.error(`Could not reach ${base}: ${(err as Error).message}`);
      process.exitCode = EXIT_CONNECTIVITY;
      return;
    }

    // Default is --latest unless --latest=false is supplied.
    const latest = args.latest !== false;
    if (latest) {
      const res = await fetch(`${base}/v1/projects/${projectId}/ai-quality/latest`, { headers });
      if (res.status === 404) {
        ui.warn(`No AI-quality reports for ${slug} yet.`);
        return;
      }
      if (!res.ok) {
        ui.error(`quality failed: HTTP ${res.status}`);
        process.exitCode = EXIT_GENERIC;
        return;
      }
      const report = (await res.json()) as QualityReport;
      renderLatest(report, slug);
      if (report.needsReview) process.exitCode = EXIT_ASSERTION_FAILED;
      return;
    }

    // Full history: paginate.
    const history: QualityReport[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const u = new URL(`${base}/v1/projects/${projectId}/ai-quality`);
      u.searchParams.set('limit', '100');
      if (cursor) u.searchParams.set('cursor', cursor);
      const res = await fetch(u, { headers });
      if (!res.ok) {
        ui.error(`quality failed: HTTP ${res.status}`);
        process.exitCode = EXIT_GENERIC;
        return;
      }
      const body = (await res.json()) as QualityHistoryResponse;
      history.push(...body.data);
      if (!body.hasMore || !body.nextCursor) break;
      cursor = body.nextCursor;
    }
    renderHistory(history, slug);
  },
});

function renderLatest(r: QualityReport, slug: string): void {
  if (isJson()) {
    getPrinter().emit({
      event: 'quality',
      level: r.needsReview ? 'warn' : 'info',
      data: r as unknown as Record<string, unknown>,
    });
    return;
  }
  ui.header(`AI Quality — ${slug} (${new Date(r.createdAt).toISOString()})`);
  const scoreLine = (label: string, value: string | null) =>
    `  ${pc.dim(label.padEnd(14))}  ${value === null ? pc.dim('n/a') : pc.cyan(value)}\n`;
  process.stdout.write(scoreLine('Resources', r.resourcesScore));
  process.stdout.write(scoreLine('Relationships', r.relationshipsScore));
  process.stdout.write(scoreLine('Min', r.minScore));
  process.stdout.write(scoreLine('Model', r.model));
  process.stdout.write(
    `  ${pc.dim('Needs review'.padEnd(14))}  ${r.needsReview ? pc.red('yes') : pc.green('no')}\n`,
  );
  if (r.issues.length > 0) {
    process.stdout.write(`\n  ${pc.dim(`Issues (${r.issues.length}):`)}\n`);
    for (const issue of r.issues.slice(0, 10)) {
      const line = typeof issue === 'string' ? issue : JSON.stringify(issue);
      process.stdout.write(`    ${pc.yellow('•')} ${line}\n`);
    }
    if (r.issues.length > 10) {
      process.stdout.write(`    ${pc.dim(`… and ${r.issues.length - 10} more`)}\n`);
    }
  }
  process.stdout.write('\n');
}

function renderHistory(rows: readonly QualityReport[], slug: string): void {
  if (isJson()) {
    for (const r of rows) {
      getPrinter().emit({
        event: 'quality',
        level: r.needsReview ? 'warn' : 'info',
        data: r as unknown as Record<string, unknown>,
      });
    }
    return;
  }
  ui.header(`AI Quality — ${slug} (${rows.length} report${rows.length === 1 ? '' : 's'})`);
  if (rows.length === 0) {
    process.stdout.write(`  ${pc.dim('(no reports)')}\n\n`);
    return;
  }
  process.stdout.write(
    `  ${pc.dim('WHEN'.padEnd(20))}  ${pc.dim('RES'.padEnd(6))}  ${pc.dim('REL'.padEnd(6))}  ${pc.dim('MIN'.padEnd(6))}  ${pc.dim('REVIEW')}\n`,
  );
  for (const r of rows) {
    const when = new Date(r.createdAt).toISOString().replace('T', ' ').replace(/\..*$/, '');
    process.stdout.write(
      `  ${pc.white(when.padEnd(20))}  ${(r.resourcesScore ?? 'n/a').padEnd(6)}  ${(r.relationshipsScore ?? 'n/a').padEnd(6)}  ${(r.minScore ?? 'n/a').padEnd(6)}  ${r.needsReview ? pc.red('yes') : pc.green('no')}\n`,
    );
  }
  process.stdout.write('\n');
}
