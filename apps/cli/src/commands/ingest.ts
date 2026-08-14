import { defineCommand } from 'citty';
import { readFile } from 'node:fs/promises';
import { createLogger } from '@carbon/core';
import { createDefaultParserRegistry, createParserContext, type ParserInput } from '@carbon/parser';
import { ui } from '../ui.js';
import { resolveApiKey } from '../lib/credentials.js';
import { checkIngestQuota, printQuotaAdvisory, printQuotaExceeded } from '../lib/quota.js';

export const ingestCommand = defineCommand({
  meta: {
    name: 'ingest',
    description: 'Parse OpenAPI, AsyncAPI, GraphQL, protobuf/gRPC, HAR, or Postman into IR.',
  },
  args: {
    source: { type: 'positional', description: 'Path to file or URL' },
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
    const ir = await parsers.parse(input, createParserContext(logger, args.source));
    ui.success(`Parsed ${ui.code(ir.api.name)} v${ir.api.version}`);
    ui.step('Endpoints', String(ir.endpoints.length));
    ui.step('Resources', String(ir.resources.length));
    ui.step('Relationships', String(ir.relationships.length));
  },
});

async function load(source: string, apiKey?: string): Promise<ParserInput> {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const headers: Record<string, string> = {};
    if (apiKey) headers['x-carbon-key'] = apiKey;
    const res = await fetch(source, { headers });
    const text = await res.text();
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
