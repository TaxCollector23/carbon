import { defineCommand } from 'citty';
import { createLogger } from '@carbon/core';
import { carbon } from '@carbon/sdk';
import type { EndpointDef, IntermediateRepresentation, JsonType, ResourceId } from '@carbon/types';
import pc from 'picocolors';
import { parseSpec } from './diff.js';
import { getPrinter, isJson } from '../lib/printer.js';
import { EXIT_ASSERTION_FAILED, EXIT_CONNECTIVITY, EXIT_GENERIC } from '../lib/exit-codes.js';
import { ui } from '../ui.js';

interface SmokeResult {
  readonly method: string;
  readonly path: string;
  readonly actualPath: string;
  readonly status: number | null;
  readonly expected: readonly number[];
  readonly passed: boolean;
  readonly failureKind?: 'connectivity' | 'assertion';
  readonly error?: string;
}

export interface SmokeReport {
  readonly spec: string;
  readonly api: { readonly name: string; readonly version: string };
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly results: readonly SmokeResult[];
}

/** Put mutating setup before reads and cleanup so a single run exercises stateful behavior. */
export function orderForSmoke(endpoints: readonly EndpointDef[]): EndpointDef[] {
  const priority: Record<EndpointDef['operation'], number> = {
    create: 0,
    list: 1,
    get: 2,
    update: 3,
    replace: 3,
    action: 4,
    custom: 4,
    delete: 5,
  };
  return endpoints
    .map((endpoint, index) => ({ endpoint, index }))
    .sort(
      (a, b) =>
        priority[a.endpoint.operation] - priority[b.endpoint.operation] || a.index - b.index,
    )
    .map(({ endpoint }) => endpoint);
}

export function sampleValue(schema: JsonType | null): unknown {
  if (!schema) return {};
  switch (schema.kind) {
    case 'string':
      return schema.enum?.[0] ?? (schema.format === 'email' ? 'carbon@example.com' : 'example');
    case 'number':
    case 'integer':
      return 1;
    case 'boolean':
      return true;
    case 'null':
      return null;
    case 'array':
      return [sampleValue(schema.items)];
    case 'object': {
      const result: Record<string, unknown> = {};
      for (const name of schema.required)
        result[name] = sampleValue(schema.properties[name] ?? null);
      return result;
    }
    case 'union':
      return sampleValue(schema.anyOf[0] ?? null);
    case 'ref':
    case 'unknown':
      return {};
  }
}

export const testCommand = defineCommand({
  meta: {
    name: 'test',
    description: 'Run a stateful smoke test against every endpoint in an API spec.',
  },
  args: {
    spec: { type: 'positional', description: 'API spec path', required: true },
    timeout: {
      type: 'string',
      description: 'Per-request timeout in seconds (default: 10).',
      default: '10',
    },
  },
  async run({ args }) {
    const specPath = String(args.spec);
    let ir: IntermediateRepresentation;
    try {
      ir = await parseSpec(specPath);
    } catch (err) {
      ui.error(`Could not parse ${specPath}: ${(err as Error).message}`);
      process.exitCode = EXIT_GENERIC;
      return;
    }

    const timeoutSeconds = normalizeTimeout(args.timeout);
    let replica: Awaited<ReturnType<typeof carbon.emulate>>;
    try {
      replica = await carbon.emulate({
        from: specPath,
        port: 0,
        host: '127.0.0.1',
        logger: createLogger({ level: 'silent', pretty: false, name: 'test' }),
      });
    } catch (err) {
      ui.error(`Could not start test replica: ${(err as Error).message}`);
      process.exitCode = EXIT_GENERIC;
      return;
    }

    const ids = new Map<ResourceId, string>();
    const results: SmokeResult[] = [];
    try {
      for (const endpoint of orderForSmoke(ir.endpoints)) {
        results.push(await exercise(endpoint, replica.url, ids, timeoutSeconds));
      }
    } finally {
      await replica.close();
    }

    const passed = results.filter((result) => result.passed).length;
    const report: SmokeReport = {
      spec: specPath,
      api: { name: ir.api.name, version: ir.api.version },
      total: results.length,
      passed,
      failed: results.length - passed,
      results,
    };

    if (isJson()) {
      getPrinter().emit({
        event: 'test',
        level: report.failed === 0 ? 'success' : 'error',
        data: report as unknown as Record<string, unknown>,
      });
    } else {
      renderReport(report);
    }

    if (report.failed > 0) {
      const onlyConnectivity = results.every(
        (result) => result.passed || result.failureKind === 'connectivity',
      );
      process.exitCode = onlyConnectivity ? EXIT_CONNECTIVITY : EXIT_ASSERTION_FAILED;
    }
  },
});

async function exercise(
  endpoint: EndpointDef,
  baseUrl: string,
  ids: Map<ResourceId, string>,
  timeoutSeconds: number,
): Promise<SmokeResult> {
  const actualPath = buildRequestPath(endpoint, ids);
  const expected = endpoint.responses.map((response) => response.status);
  const headers: Record<string, string> = {};
  const methodHasBody = ['POST', 'PUT', 'PATCH'].includes(endpoint.method);
  let body: string | undefined;
  if (methodHasBody) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(sampleValue(endpoint.requestBody));
  }

  for (const param of endpoint.params) {
    if (param.in === 'header' && param.required) headers[param.name] = 'example';
  }

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}${actualPath}`,
      {
        method: endpoint.method,
        headers,
        body,
      },
      timeoutSeconds,
    );
    const text = await response.text();
    const passed =
      expected.length === 0 ? response.status < 400 : expected.includes(response.status);

    if (endpoint.operation === 'create' && endpoint.resource) {
      const id = extractId(text);
      if (id) ids.set(endpoint.resource, id);
    }
    return {
      method: endpoint.method,
      path: endpoint.path,
      actualPath,
      status: response.status,
      expected,
      passed,
      ...(passed
        ? {}
        : { failureKind: 'assertion' as const, error: `received HTTP ${response.status}` }),
    };
  } catch (err) {
    return {
      method: endpoint.method,
      path: endpoint.path,
      actualPath,
      status: null,
      expected,
      passed: false,
      failureKind: 'connectivity',
      error: (err as Error).message,
    };
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutSeconds: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildRequestPath(endpoint: EndpointDef, ids: Map<ResourceId, string>): string {
  let path = endpoint.path.replace(/\{([^/}]+)\}/g, (_match, name: string) => {
    if (endpoint.resource) return ids.get(endpoint.resource) ?? exampleParam(name);
    return exampleParam(name);
  });
  const query = new URLSearchParams();
  for (const param of endpoint.params) {
    if (param.in === 'query' && param.required) query.set(param.name, exampleParam(param.name));
  }
  const encoded = query.toString();
  if (encoded) path += `?${encoded}`;
  return path;
}

function exampleParam(name: string): string {
  return /(^|_)id$/i.test(name) || name.toLowerCase() === 'id' ? '1' : 'example';
}

function extractId(text: string): string | null {
  try {
    const value = JSON.parse(text) as { id?: unknown };
    return typeof value.id === 'string' && value.id.length > 0 ? value.id : null;
  } catch {
    return null;
  }
}

function normalizeTimeout(raw: unknown): number {
  const value = Number(raw ?? 10);
  return Number.isFinite(value) ? Math.max(1, Math.min(value, 60)) : 10;
}

function renderReport(report: SmokeReport): void {
  ui.header(`Carbon test — ${report.api.name} v${report.api.version}`);
  for (const result of report.results) {
    const symbol = result.passed ? pc.green('✓') : pc.red('✗');
    const status = result.status === null ? 'error' : String(result.status);
    const expected = result.expected.length > 0 ? result.expected.join('|') : '2xx/3xx';
    const detail = result.passed
      ? pc.dim(`→ ${status}`)
      : pc.red(`${result.error ?? `expected ${expected}`}`);
    process.stdout.write(`  ${symbol} ${result.method} ${result.path} ${detail}\n`);
  }
  if (report.failed === 0)
    ui.success(`${report.passed}/${report.total} endpoint smoke tests passed.`);
  else ui.error(`${report.failed}/${report.total} endpoint smoke tests failed.`);
}
