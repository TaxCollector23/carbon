import { defineCommand } from 'citty';
import { readFile } from 'node:fs/promises';
import { createLogger } from '@carbon/core';
import { createDefaultParserRegistry, createParserContext, type ParserInput } from '@carbon/parser';
import { ui } from '../ui.js';
import { resolveApiKey } from '../lib/credentials.js';
import { checkIngestQuota, printQuotaAdvisory, printQuotaExceeded } from '../lib/quota.js';
import { EXIT_CONNECTIVITY, EXIT_GENERIC } from '../lib/exit-codes.js';

export const ingestCommand = defineCommand({
  meta: {
    name: 'ingest',
    description: 'Parse OpenAPI, AsyncAPI, GraphQL, protobuf/gRPC, HAR, or Postman into IR.',
  },
  args: {
    source: { type: 'positional', description: 'Path to file or URL' },
    project: {
      type: 'string',
      description: 'Persist the parsed spec to this control-plane project slug.',
    },
    async: {
      type: 'boolean',
      description: 'Queue remote ingestion and return a job id immediately.',
      default: false,
    },
    wait: {
      type: 'boolean',
      description: 'Wait for a queued remote ingestion job to finish.',
      default: false,
    },
    timeout: {
      type: 'string',
      description: 'Maximum seconds to wait with --wait (default: 60).',
      default: '60',
    },
    'api-url': { type: 'string', description: 'Carbon control-plane URL override' },
    'api-key': { type: 'string', description: 'API key (defaults to ~/.carbon/credentials)' },
  },
  async run({ args }) {
    const logger = createLogger({ level: 'info', pretty: true, name: 'ingest' });
    const parsers = createDefaultParserRegistry();

    const resolved = await resolveApiKey(
      { flag: args['api-key'] as string | undefined },
      args['api-url'] as string | undefined,
    );
    const isRemote = /^https?:\/\//.test(args.source);
    const isCarbonRemote =
      isRemote && resolved?.apiUrl ? args.source.startsWith(resolved.apiUrl) : false;
    if (isCarbonRemote && !resolved) {
      ui.error('No API credentials found. Run `carbon login` first, or pass --api-key.');
      process.exitCode = 1;
      return;
    }

    // Free-tier paywall — surface an upsell at the exact moment of friction
    // rather than only on the marketing site. Fails open on any error so a
    // control-plane outage never breaks the CLI.
    if (resolved) {
      const quota = await checkIngestQuota({ apiUrl: resolved.apiUrl, apiKey: resolved.key });
      if (quota.blocked) {
        printQuotaExceeded(quota);
        process.exitCode = 2;
        return;
      }
      printQuotaAdvisory(quota);
    }

    const input = await load(args.source, resolved?.key);
    const project = args.project ? String(args.project) : undefined;
    if (project) {
      if (!resolved) {
        ui.error(
          'Remote ingestion needs credentials. Run `carbon login` first, or pass --api-key.',
        );
        process.exitCode = EXIT_GENERIC;
        return;
      }
      await ingestRemote({
        apiUrl: resolved.apiUrl,
        apiKey: resolved.key,
        project,
        source: input,
        async: args.async === true,
        wait: args.wait === true,
        timeoutSeconds: Number(args.timeout ?? 60),
      });
      return;
    }

    const ir = await parsers.parse(input, createParserContext(logger, args.source));
    ui.success(`Parsed ${ui.code(ir.api.name)} v${ir.api.version}`);
    ui.step('Endpoints', String(ir.endpoints.length));
    ui.step('Resources', String(ir.resources.length));
    ui.step('Relationships', String(ir.relationships.length));
  },
});

interface RemoteIngestOptions {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly project: string;
  readonly source: ParserInput;
  readonly async: boolean;
  readonly wait: boolean;
  readonly timeoutSeconds: number;
}

async function ingestRemote(options: RemoteIngestOptions): Promise<void> {
  const base = options.apiUrl.replace(/\/+$/, '');
  const headers = { 'content-type': 'application/json', 'x-carbon-key': options.apiKey };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch(`${base}/v1/ingest`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        projectSlug: options.project,
        source: options.source,
        origin: 'cli',
        async: options.async,
      }),
    });
  } catch (err) {
    const detail =
      err instanceof Error && err.name === 'AbortError'
        ? 'timed out after 30s'
        : (err as Error).message;
    ui.error(`Remote ingest could not reach ${base}: ${detail}`);
    process.exitCode = EXIT_CONNECTIVITY;
    return;
  } finally {
    clearTimeout(timeout);
  }

  const body = (await response.json().catch(() => null)) as {
    irId?: string;
    graphId?: string;
    endpoints?: number;
    resources?: number;
    jobId?: string;
    status?: string;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    ui.error(
      `Remote ingest failed: HTTP ${response.status}${body?.error?.message ? ` — ${body.error.message}` : ''}`,
    );
    process.exitCode = response.status >= 500 ? EXIT_CONNECTIVITY : EXIT_GENERIC;
    return;
  }

  if (body?.jobId) {
    ui.event('ingest.queued', {
      jobId: body.jobId,
      project: options.project,
      status: body.status ?? 'queued',
    });
    if (options.wait)
      await waitForRemoteJob(base, options.apiKey, body.jobId, options.timeoutSeconds);
    return;
  }
  ui.success(`Ingested ${ui.code(options.project)} into the control plane.`);
  ui.step('IR', body?.irId ?? 'unknown');
  ui.step('Graph', body?.graphId ?? 'unknown');
  ui.step('Endpoints', String(body?.endpoints ?? 0));
  ui.step('Resources', String(body?.resources ?? 0));
}

async function waitForRemoteJob(
  base: string,
  apiKey: string,
  jobId: string,
  timeoutSeconds: number,
): Promise<void> {
  const timeoutMs =
    Math.max(1, Math.min(Number.isFinite(timeoutSeconds) ? timeoutSeconds : 60, 600)) * 1000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/v1/jobs/${encodeURIComponent(jobId)}`, {
      headers: { 'x-carbon-key': apiKey },
    }).catch(() => null);
    const body = response
      ? ((await response.json().catch(() => null)) as { status?: string; error?: string } | null)
      : null;
    const status = body?.status;
    if (status === 'succeeded' || status === 'needs_review') {
      ui.event('ingest.completed', { jobId, status }, status === 'needs_review' ? 'warn' : 'info');
      return;
    }
    if (status === 'failed') {
      ui.error(`Remote ingest job ${jobId} failed${body?.error ? `: ${body.error}` : ''}`);
      process.exitCode = EXIT_GENERIC;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  ui.error(`Remote ingest job ${jobId} did not finish within ${Math.round(timeoutMs / 1000)}s.`);
  process.exitCode = EXIT_CONNECTIVITY;
}

async function load(source: string, apiKey?: string): Promise<ParserInput> {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const headers: Record<string, string> = {};
    if (apiKey) headers['x-carbon-key'] = apiKey;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let res: Response;
    try {
      res = await fetch(source, { headers, signal: controller.signal });
    } catch (err) {
      const detail =
        err instanceof Error && err.name === 'AbortError'
          ? 'timed out after 30s'
          : (err as Error).message;
      throw new Error(`Could not fetch ${source}: ${detail}`);
    } finally {
      clearTimeout(timeout);
    }
    const text = await res.text();
    if (!res.ok) {
      const excerpt = text.replace(/\s+/g, ' ').trim().slice(0, 180);
      throw new Error(
        `Could not fetch ${source}: HTTP ${res.status}${excerpt ? ` — ${excerpt}` : ''}`,
      );
    }
    try {
      return { kind: 'json', content: JSON.parse(text) };
    } catch {
      return { kind: 'text', content: text };
    }
  }
  const text = await readFile(source, 'utf8');
  try {
    return { kind: 'json', content: JSON.parse(text) };
  } catch {
    return { kind: 'text', content: text };
  }
}
