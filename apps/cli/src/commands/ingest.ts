import { defineCommand } from 'citty';
import { readFile } from 'node:fs/promises';
import { createLogger } from '@carbon/core';
import { createDefaultParserRegistry, createParserContext, type ParserInput } from '@carbon/parser';
import { ui } from '../ui.js';

export const ingestCommand = defineCommand({
  meta: {
    name: 'ingest',
    description: 'Parse OpenAPI, AsyncAPI, GraphQL, protobuf/gRPC, HAR, or Postman into IR.',
  },
  args: {
    source: { type: 'positional', description: 'Path to file or URL' },
  },
  async run({ args }) {
    const logger = createLogger({ level: 'info', pretty: true, name: 'ingest' });
    const parsers = createDefaultParserRegistry();

    const input = await load(args.source);
    const ir = await parsers.parse(input, createParserContext(logger, args.source));
    ui.success(`Parsed ${ui.code(ir.api.name)} v${ir.api.version}`);
    ui.step('Endpoints', String(ir.endpoints.length));
    ui.step('Resources', String(ir.resources.length));
    ui.step('Relationships', String(ir.relationships.length));
  },
});

async function load(source: string): Promise<ParserInput> {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const res = await fetch(source);
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
