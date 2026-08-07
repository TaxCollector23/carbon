import type { Logger } from '@carbon/core';
import { createParserContext, HarParser, OpenApiParser, ParserRegistry, PostmanParser, GraphQLParser } from '@carbon/parser';
import { createIngestionPipeline } from '@carbon/ingestion';
import type { Storage } from '@carbon/storage';

/**
 * Background ingestion — accepts a URL or literal document, runs it through
 * the pipeline, and persists the resulting IR + behavior graph. Enrichment
 * is off by default so the job is fully deterministic. Callers who want AI
 * enrichment enqueue the `enrich` job separately.
 */
export function makeIngestHandler(deps: { storage: Storage; logger: Logger }) {
  const parsers = new ParserRegistry()
    .register(new OpenApiParser())
    .register(new HarParser())
    .register(new PostmanParser())
    .register(new GraphQLParser());
  const pipeline = createIngestionPipeline({ parsers, storage: deps.storage, logger: deps.logger });

  return async (payload: { projectSlug: string; source: string }) => {
    deps.logger.info('workers.ingest.start', payload);
    const input = await load(payload.source);
    const result = await pipeline.ingest({
      projectSlug: payload.projectSlug,
      input,
      origin: payload.source,
    });
    deps.logger.info('workers.ingest.done', {
      irId: result.irId,
      graphId: result.graphId,
      endpoints: result.ir.endpoints.length,
    });
  };
}

async function load(source: string) {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const res = await fetch(source);
    const text = await res.text();
    try {
      return { kind: 'json' as const, content: JSON.parse(text) };
    } catch {
      return { kind: 'text' as const, content: text };
    }
  }
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(source, 'utf8');
  try {
    return { kind: 'json' as const, content: JSON.parse(text) };
  } catch {
    return { kind: 'text' as const, content: text };
  }
}
