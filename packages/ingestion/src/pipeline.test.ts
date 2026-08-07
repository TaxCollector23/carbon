import { describe, expect, it } from 'vitest';
import { NoopLogger } from '@carbon/core';
import { OpenApiParser, ParserRegistry } from '@carbon/parser';
import { MemoryStorage } from '@carbon/storage';
import { createIngestionPipeline } from './index.js';

const openApiDoc = {
  openapi: '3.0.0',
  info: { title: 'Widgets', version: '1.0.0' },
  paths: {
    '/widgets': {
      get: { tags: ['Widget'], responses: { '200': { description: 'ok' } } },
      post: { tags: ['Widget'], responses: { '201': { description: 'ok' } } },
    },
    '/widgets/{id}': {
      get: {
        tags: ['Widget'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'ok' } },
      },
      delete: {
        tags: ['Widget'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'ok' } },
      },
    },
    '/widgets/{id}/parts': {
      get: {
        tags: ['Part'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'ok' } },
      },
    },
  },
};

describe('ingestion pipeline', () => {
  it('parses, compiles, and persists an ingest', async () => {
    const storage = new MemoryStorage();
    const parsers = new ParserRegistry().register(new OpenApiParser());
    const pipeline = createIngestionPipeline({
      parsers,
      storage,
      logger: NoopLogger,
      clock: () => 1_700_000_000_000,
    });

    const result = await pipeline.ingest({
      projectSlug: 'acme',
      input: { kind: 'json', content: openApiDoc, hint: 'openapi' },
      origin: 'test://widgets',
    });

    expect(result.ir.api.name).toBe('Widgets');
    expect(result.ir.endpoints.length).toBe(5);
    expect(result.ir.resources.map((r) => r.name).sort()).toEqual(['Part', 'Widget']);
    expect(result.graph.nodes).toHaveLength(2);
    // Nested path infers an ownership relationship: widget → part
    expect(
      result.ir.relationships.some((r) => r.kind === 'owns' && String(r.from) === 'widget'),
    ).toBe(true);

    // Artifacts were persisted
    const irBytes = await storage.get(`projects/acme/ir/${result.irId}.json`);
    const graphBytes = await storage.get(`projects/acme/graphs/${result.graphId}.json`);
    expect(irBytes).not.toBeNull();
    expect(graphBytes).not.toBeNull();
  });
});
