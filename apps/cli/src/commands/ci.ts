import { defineCommand } from 'citty';
import { BehaviorGraphBuilder } from '@carbon/graph';
import type { IntermediateRepresentation } from '@carbon/types';
import pc from 'picocolors';
import { compareIr, parseSpec, type SpecDiff } from './diff.js';
import { getPrinter, isJson } from '../lib/printer.js';
import { EXIT_ASSERTION_FAILED, EXIT_GENERIC } from '../lib/exit-codes.js';
import { ui } from '../ui.js';

export interface CiIssue {
  readonly code: string;
  readonly message: string;
}

export interface CiResult {
  readonly spec: string;
  readonly api: { readonly name: string; readonly version: string };
  readonly counts: {
    readonly endpoints: number;
    readonly resources: number;
    readonly relationships: number;
    readonly transitions: number;
    readonly constraints: number;
  };
  readonly issues: readonly CiIssue[];
  readonly drift: SpecDiff | null;
  readonly passed: boolean;
}

/** Validate references that the parser can represent but the graph compiler cannot repair. */
export function validateIr(ir: IntermediateRepresentation): CiIssue[] {
  const issues: CiIssue[] = [];
  const resourceIds = new Set(ir.resources.map((resource) => resource.id));
  const endpointKeys = new Set<string>();

  for (const endpoint of ir.endpoints) {
    const key = `${endpoint.method.toUpperCase()} ${endpoint.path}`;
    if (endpointKeys.has(key)) {
      issues.push({ code: 'duplicate_endpoint', message: `Duplicate endpoint: ${key}` });
    }
    endpointKeys.add(key);
    if (endpoint.resource && !resourceIds.has(endpoint.resource)) {
      issues.push({
        code: 'missing_endpoint_resource',
        message: `${key} references missing resource ${endpoint.resource}`,
      });
    }
  }

  for (const relationship of ir.relationships) {
    if (!resourceIds.has(relationship.from)) {
      issues.push({
        code: 'missing_relationship_source',
        message: `Relationship source does not exist: ${relationship.from}`,
      });
    }
    if (!resourceIds.has(relationship.to)) {
      issues.push({
        code: 'missing_relationship_target',
        message: `Relationship target does not exist: ${relationship.to}`,
      });
    }
  }

  return issues;
}

export const ciCommand = defineCommand({
  meta: {
    name: 'ci',
    description: 'Validate an API contract and optionally gate normalized spec drift in CI.',
  },
  args: {
    spec: { type: 'positional', description: 'Current API spec path', required: true },
    against: {
      type: 'string',
      description: 'Optional baseline spec; any normalized drift fails the check.',
    },
  },
  async run({ args }) {
    const specPath = String(args.spec);
    let ir: IntermediateRepresentation;
    try {
      ir = await parseSpec(specPath);
    } catch (err) {
      reportError(`Could not parse ${specPath}: ${(err as Error).message}`);
      return;
    }

    let drift: SpecDiff | null = null;
    const against = args.against ? String(args.against) : undefined;
    if (against) {
      try {
        const baseline = await parseSpec(against);
        drift = compareIr(baseline, ir);
      } catch (err) {
        reportError(`Could not parse baseline ${against}: ${(err as Error).message}`);
        return;
      }
    }

    let graph;
    try {
      graph = new BehaviorGraphBuilder().build(ir);
    } catch (err) {
      reportError(`Could not compile behavior graph: ${(err as Error).message}`);
      return;
    }

    const issues = validateIr(ir);
    const passed = issues.length === 0 && (drift === null || drift.summary.total === 0);
    const result: CiResult = {
      spec: specPath,
      api: { name: ir.api.name, version: ir.api.version },
      counts: {
        endpoints: ir.endpoints.length,
        resources: ir.resources.length,
        relationships: ir.relationships.length,
        transitions: graph.transitions.length,
        constraints: graph.constraints.length,
      },
      issues,
      drift,
      passed,
    };

    if (isJson()) {
      getPrinter().emit({
        event: 'ci',
        level: passed ? 'success' : 'error',
        data: result as unknown as Record<string, unknown>,
      });
    } else {
      renderResult(result, against);
    }

    if (!passed) {
      process.exitCode = drift && drift.summary.total > 0 ? EXIT_ASSERTION_FAILED : EXIT_GENERIC;
    }
  },
});

function reportError(message: string): void {
  ui.error(message);
  process.exitCode = EXIT_GENERIC;
}

function renderResult(result: CiResult, against: string | undefined): void {
  ui.header(`Carbon CI — ${result.api.name} v${result.api.version}`);
  ui.step('Spec', result.spec);
  ui.step(
    'Graph',
    `${result.counts.endpoints} endpoints · ${result.counts.resources} resources · ${result.counts.transitions} transitions`,
  );
  ui.step(
    'Relationships',
    `${result.counts.relationships} · ${result.counts.constraints} constraints`,
  );

  for (const issue of result.issues) {
    process.stdout.write(`  ${pc.red('✗')} ${issue.code}: ${issue.message}\n`);
  }
  if (against && result.drift) {
    const { added, removed, changed, total } = result.drift.summary;
    ui.step(
      'Drift',
      `${total} change${total === 1 ? '' : 's'} (${added} added, ${removed} removed, ${changed} changed)`,
    );
  }

  if (result.passed) ui.success('Contract checks passed.');
  else ui.error('Contract checks failed.');
}
