import type { Logger } from '@carbon/core';
import { BehaviorGraphBuilder } from '@carbon/graph';
import type { ParserInput, ParserRegistry } from '@carbon/parser';
import { createParserContext } from '@carbon/parser';
import { StorageKeys, type Storage } from '@carbon/storage';
import type { AiCapabilities } from '@carbon/ai';
import type { BehaviorGraph, IntermediateRepresentation } from '@carbon/types';
import { makeId } from '@carbon/core';

/**
 * The Ingestion orchestrator wires the pipeline end-to-end for a single
 * ingest: parse → enrich (AI, optional) → compile behavior graph → persist.
 *
 * Enrichment is best-effort: if the AI layer is unavailable or opted-out,
 * ingestion completes with the mechanically-derived graph. This preserves
 * Carbon's "deterministic runtime, AI-only-during-analysis" contract.
 */
export interface IngestionPipeline {
  ingest(input: IngestRequest): Promise<IngestResult>;
}

export interface IngestRequest {
  readonly projectSlug: string;
  readonly input: ParserInput;
  readonly origin?: string;
  readonly enrich?: boolean;
}

export interface IngestResult {
  readonly irId: string;
  readonly graphId: string;
  readonly ir: IntermediateRepresentation;
  readonly graph: BehaviorGraph;
  readonly warnings: readonly string[];
}

export interface IngestionDeps {
  readonly parsers: ParserRegistry;
  readonly storage: Storage;
  readonly logger: Logger;
  readonly ai?: AiCapabilities;
  readonly clock?: () => number;
}

export function createIngestionPipeline(deps: IngestionDeps): IngestionPipeline {
  const clock = deps.clock ?? (() => Date.now());
  const builder = new BehaviorGraphBuilder();

  return {
    async ingest(req) {
      const warnings: string[] = [];
      const ctx = createParserContext(deps.logger, req.origin);
      const originalWarn = ctx.warn;
      const captured = {
        ...ctx,
        warn(message: string, details?: Record<string, unknown>) {
          warnings.push(message);
          originalWarn(message, details);
        },
      };

      const parsedIr = await deps.parsers.parse(req.input, captured);
      const ir: IntermediateRepresentation = {
        ...parsedIr,
        api: {
          ...parsedIr.api,
          source: { ...parsedIr.api.source, ingestedAt: clock() },
        },
      };

      if (req.enrich && deps.ai) {
        try {
          const enrichedResources = await deps.ai.inferResources({ ir });
          Object.assign(ir, { resources: enrichedResources });
          const enrichedRelationships = await deps.ai.inferRelationships({
            ir,
            resources: enrichedResources,
          });
          Object.assign(ir, { relationships: enrichedRelationships });
        } catch (err) {
          deps.logger.warn('ingestion.ai_enrichment_failed', {
            message: (err as Error).message,
          });
          warnings.push('AI enrichment failed — proceeding with mechanically-derived graph');
        }
      }

      const graph = builder.build(ir);
      const irId = makeId('ir');
      const graphId = makeId('grf');

      await deps.storage.put(StorageKeys.ir(req.projectSlug, irId), JSON.stringify(ir), {
        contentType: 'application/json',
      });
      await deps.storage.put(
        StorageKeys.graph(req.projectSlug, graphId),
        JSON.stringify(graph),
        { contentType: 'application/json' },
      );

      return { irId, graphId, ir, graph, warnings };
    },
  };
}
