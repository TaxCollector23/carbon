import { defineCommand } from 'citty';
import { readFile } from 'node:fs/promises';
import { createLogger } from '@carbon/core';
import { BehaviorGraphBuilder } from '@carbon/graph';
import { createDefaultParserRegistry, createParserContext, type ParserInput } from '@carbon/parser';
import type { EndpointDef, IntermediateRepresentation } from '@carbon/types';
import { ui } from '../ui.js';
import { getPrinter, isJson } from '../lib/printer.js';
import { EXIT_GENERIC } from '../lib/exit-codes.js';

export interface ExplainTarget {
  readonly method: string;
  readonly path: string;
}

export function parseExplainTarget(value: string): ExplainTarget {
  const match = value.trim().match(/^([A-Za-z]+)\s+(.+)$/);
  if (!match?.[1] || !match[2]) {
    throw new Error('Endpoint must look like `POST /pets` (method followed by an API path).');
  }
  return { method: match[1].toUpperCase(), path: match[2] };
}

export const explainCommand = defineCommand({
  meta: {
    name: 'explain',
    description: 'Explain why an endpoint reads or mutates state in a Carbon replica.',
  },
  args: {
    spec: { type: 'positional', description: 'Path to an API spec', required: true },
    endpoint: {
      type: 'positional',
      description: 'Endpoint to explain, for example `POST /pets`',
      required: true,
    },
  },
  async run({ args }) {
    let target: ExplainTarget;
    let ir: IntermediateRepresentation;
    try {
      target = parseExplainTarget(String(args.endpoint));
      ir = await parseSpec(String(args.spec));
    } catch (err) {
      ui.error(`Could not explain endpoint: ${(err as Error).message}`);
      process.exitCode = EXIT_GENERIC;
      return;
    }

    const endpoint = ir.endpoints.find(
      (candidate) =>
        candidate.method.toUpperCase() === target.method && candidate.path === target.path,
    );
    if (!endpoint) {
      const available = ir.endpoints
        .slice(0, 12)
        .map((candidate) => `${candidate.method} ${candidate.path}`)
        .join(', ');
      ui.error(
        `Endpoint not found: ${target.method} ${target.path}${available ? `. Try: ${available}` : ''}`,
      );
      process.exitCode = EXIT_GENERIC;
      return;
    }

    const graph = new BehaviorGraphBuilder().build(ir);
    const resource = endpoint.resource
      ? ir.resources.find((candidate) => candidate.id === endpoint.resource)
      : undefined;
    const transition = graph.transitions.find((candidate) => candidate.endpoint === endpoint.id);
    const relationships = endpoint.resource
      ? graph.edges.filter(
          (edge) => edge.from === endpoint.resource || edge.to === endpoint.resource,
        )
      : [];
    const constraints = endpoint.resource
      ? graph.constraints.filter(
          (constraint) =>
            ('resource' in constraint && constraint.resource === endpoint.resource) ||
            ('from' in constraint && constraint.from === endpoint.resource) ||
            ('to' in constraint && constraint.to === endpoint.resource),
        )
      : [];

    const explanation = {
      api: ir.api,
      endpoint: {
        method: endpoint.method,
        path: endpoint.path,
        operation: endpoint.operation,
        auth: endpoint.auth,
        params: endpoint.params,
        responses: endpoint.responses,
      },
      resource: resource
        ? { id: resource.id, name: resource.name, primaryKey: resource.primaryKey }
        : null,
      transition: transition ?? null,
      relationships,
      constraints,
    };

    if (isJson()) {
      getPrinter().emit({ event: 'explain', level: 'info', data: explanation });
      return;
    }
    renderExplanation(explanation, endpoint);
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
  const logger = createLogger({ level: 'silent', pretty: false, name: 'explain' });
  return createDefaultParserRegistry().parse(input, createParserContext(logger, path));
}

function renderExplanation(
  explanation: {
    endpoint: {
      method: string;
      path: string;
      operation: string;
      auth: readonly string[];
    };
    resource: { id: string; name: string; primaryKey: string } | null;
    transition: unknown;
    relationships: readonly unknown[];
    constraints: readonly unknown[];
  },
  endpoint: EndpointDef,
): void {
  ui.header(`Explain ${explanation.endpoint.method} ${explanation.endpoint.path}`);
  ui.step('Operation', explanation.endpoint.operation);
  ui.step('Resource', explanation.resource?.name ?? 'none — deterministic acknowledgement only');
  ui.step('Authentication', endpoint.auth.length > 0 ? endpoint.auth.join(', ') : 'public');
  ui.step(
    'Parameters',
    endpoint.params.length > 0
      ? endpoint.params.map((p) => `${p.in}:${p.name}`).join(', ')
      : 'none',
  );
  ui.step(
    'Transition',
    explanation.transition ? 'state change compiled' : 'read-only or custom response',
  );

  if (explanation.transition) {
    process.stdout.write(`\n  Effects\n${indentJson(explanation.transition)}\n`);
  }
  if (explanation.relationships.length > 0) {
    process.stdout.write(`\n  Relationships\n${indentJson(explanation.relationships)}\n`);
  }
  if (explanation.constraints.length > 0) {
    process.stdout.write(`\n  Constraints\n${indentJson(explanation.constraints)}\n`);
  }
  process.stdout.write('\n');
}

function indentJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}
