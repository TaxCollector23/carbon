import { defineCommand } from 'citty';
import { readFile } from 'node:fs/promises';
import { createLogger } from '@carbon/core';
import { createDefaultParserRegistry, createParserContext, type ParserInput } from '@carbon/parser';
import type { IntermediateRepresentation } from '@carbon/types';
import pc from 'picocolors';
import { ui } from '../ui.js';
import { getPrinter, isJson } from '../lib/printer.js';
import { EXIT_ASSERTION_FAILED, EXIT_GENERIC } from '../lib/exit-codes.js';

export type DiffKind = 'added' | 'removed' | 'changed';
export type DiffSubject = 'api' | 'endpoint' | 'resource' | 'relationship';

export interface DiffChange {
  readonly kind: DiffKind;
  readonly subject: DiffSubject;
  readonly key: string;
  readonly detail?: string;
}

export interface SpecDiff {
  readonly changes: readonly DiffChange[];
  readonly summary: {
    readonly added: number;
    readonly removed: number;
    readonly changed: number;
    readonly total: number;
  };
}

/**
 * Compare normalized Carbon IR instead of raw source text. This keeps a
 * harmless YAML reorder or OpenAPI formatting change out of a CI diff while
 * surfacing real endpoint, resource, relationship, and API metadata changes.
 */
export function compareIr(
  before: IntermediateRepresentation,
  after: IntermediateRepresentation,
): SpecDiff {
  const changes: DiffChange[] = [];
  if (before.api.name !== after.api.name || before.api.version !== after.api.version) {
    changes.push({
      kind: 'changed',
      subject: 'api',
      key: before.api.name,
      detail: `${before.api.name} v${before.api.version} → ${after.api.name} v${after.api.version}`,
    });
  }

  compareMaps(
    changes,
    'endpoint',
    before.endpoints,
    after.endpoints,
    (endpoint) => `${endpoint.method.toUpperCase()} ${endpoint.path}`,
    (endpoint) => ({
      method: endpoint.method,
      path: endpoint.path,
      operation: endpoint.operation,
      resource: endpoint.resource,
      params: endpoint.params,
      requestBody: endpoint.requestBody,
      responses: endpoint.responses,
      auth: endpoint.auth,
    }),
  );
  compareMaps(
    changes,
    'resource',
    before.resources,
    after.resources,
    (resource) => resource.name,
    (resource) => ({
      name: resource.name,
      primaryKey: resource.primaryKey,
      schema: resource.schema,
    }),
  );
  compareMaps(
    changes,
    'relationship',
    before.relationships,
    after.relationships,
    (relationship) =>
      `${relationship.from}->${relationship.to}:${relationship.kind}:${relationship.via}`,
    (relationship) => relationship,
  );

  const summary = {
    added: changes.filter((change) => change.kind === 'added').length,
    removed: changes.filter((change) => change.kind === 'removed').length,
    changed: changes.filter((change) => change.kind === 'changed').length,
    total: changes.length,
  };
  return { changes, summary };
}

export const diffCommand = defineCommand({
  meta: {
    name: 'diff',
    description: 'Compare two API specs after normalizing them into Carbon IR.',
  },
  args: {
    before: { type: 'positional', description: 'Previous spec path', required: true },
    after: { type: 'positional', description: 'New spec path', required: true },
  },
  async run({ args }) {
    const beforePath = String(args.before);
    const afterPath = String(args.after);
    let before: IntermediateRepresentation;
    let after: IntermediateRepresentation;
    try {
      [before, after] = await Promise.all([parseSpec(beforePath), parseSpec(afterPath)]);
    } catch (err) {
      ui.error(`Could not compare specs: ${(err as Error).message}`);
      process.exitCode = EXIT_GENERIC;
      return;
    }

    const diff = compareIr(before, after);
    if (isJson()) {
      getPrinter().emit({
        event: 'diff',
        level: diff.summary.total === 0 ? 'success' : 'warn',
        data: {
          before: beforePath,
          after: afterPath,
          ...diff.summary,
          changes: diff.changes,
        },
      });
    } else {
      renderDiff(beforePath, afterPath, diff);
    }
    if (diff.summary.total > 0) process.exitCode = EXIT_ASSERTION_FAILED;
  },
});

async function parseSpec(path: string): Promise<IntermediateRepresentation> {
  const raw = await readFile(path, 'utf8');
  const input: ParserInput = (() => {
    try {
      return { kind: 'json', content: JSON.parse(raw) };
    } catch {
      return { kind: 'text', content: raw };
    }
  })();
  const logger = createLogger({ level: 'silent', pretty: false, name: 'diff' });
  return createDefaultParserRegistry().parse(input, createParserContext(logger, path));
}

function compareMaps<T>(
  changes: DiffChange[],
  subject: Exclude<DiffSubject, 'api'>,
  before: readonly T[],
  after: readonly T[],
  keyOf: (value: T) => string,
  comparable: (value: T) => unknown,
): void {
  const beforeByKey = new Map(before.map((value) => [keyOf(value), value] as const));
  const afterByKey = new Map(after.map((value) => [keyOf(value), value] as const));

  for (const [key] of beforeByKey) {
    if (!afterByKey.has(key)) changes.push({ kind: 'removed', subject, key });
  }
  for (const [key, value] of afterByKey) {
    if (!beforeByKey.has(key)) {
      changes.push({ kind: 'added', subject, key });
      continue;
    }
    const previous = beforeByKey.get(key)!;
    if (stableJson(comparable(previous)) !== stableJson(comparable(value))) {
      changes.push({ kind: 'changed', subject, key });
    }
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sortObject(item)]),
  );
}

function renderDiff(before: string, after: string, diff: SpecDiff): void {
  ui.header(`Carbon diff — ${before} → ${after}`);
  const { added, removed, changed, total } = diff.summary;
  if (total === 0) {
    ui.success('No normalized API changes detected.');
    return;
  }
  ui.step('Added', pc.green(String(added)));
  ui.step('Removed', pc.red(String(removed)));
  ui.step('Changed', pc.yellow(String(changed)));
  process.stdout.write('\n');
  for (const change of diff.changes) {
    const symbol =
      change.kind === 'added'
        ? pc.green('+')
        : change.kind === 'removed'
          ? pc.red('-')
          : pc.yellow('~');
    const detail = change.detail ? pc.dim(` — ${change.detail}`) : '';
    process.stdout.write(`  ${symbol} ${change.subject.padEnd(12)} ${change.key}${detail}\n`);
  }
  process.stdout.write(
    `\n${pc.dim('Changes detected; exiting with code 2 for CI drift checks.')}\n`,
  );
}
