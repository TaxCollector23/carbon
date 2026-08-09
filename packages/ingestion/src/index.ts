import type { Logger } from '@carbon/core';
import { BehaviorGraphBuilder } from '@carbon/graph';
import type { ParserInput, ParserRegistry } from '@carbon/parser';
import { createParserContext } from '@carbon/parser';
import { StorageKeys, type Storage } from '@carbon/storage';
import type { AiCapabilities, AiJudge, JudgeVerdict } from '@carbon/ai';
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
  /**
   * Attribution context threaded into the AI provider's usage callback. When
   * the API resolves an org for the caller, it flows through here so
   * `onUsage(evt)` can bill against the right tenant. Optional — non-org
   * callers (CLI, system tasks) leave this unset.
   */
  readonly context?: { readonly orgId?: string; readonly projectId?: string };
}

export interface IngestJudgeReport {
  readonly resources: JudgeVerdict;
  readonly relationships: JudgeVerdict;
}

export interface IngestResult {
  readonly irId: string;
  readonly graphId: string;
  readonly ir: IntermediateRepresentation;
  readonly graph: BehaviorGraph;
  readonly warnings: readonly string[];
  /**
   * Present only when `enrich=true` and both an AI capability and an AI judge
   * were configured. Consumers use `min(resources.score, relationships.score)`
   * against a threshold to decide whether to auto-promote or hold for review.
   */
  readonly judge?: IngestJudgeReport;
  /**
   * Threshold the judge is configured against. Echoed here so downstream
   * consumers (SDK, API persistence path) do not have to reach back into the
   * pipeline deps to know what score gates auto-promotion.
   */
  readonly judgeThreshold?: number;
}

export interface IngestionDeps {
  readonly parsers: ParserRegistry;
  readonly storage: Storage;
  readonly logger: Logger;
  readonly ai?: AiCapabilities;
  /** Optional adversarial judge run after AI enrichment. */
  readonly judge?: AiJudge;
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
      let ir: IntermediateRepresentation = {
        ...parsedIr,
        api: {
          ...parsedIr.api,
          source: { ...parsedIr.api.source, ingestedAt: clock() },
        },
      };

      let judge: IngestJudgeReport | undefined;
      if (req.enrich && deps.ai) {
        try {
          const enrichedResources = await deps.ai.inferResources({ ir }, req.context);
          ir = { ...ir, resources: enrichedResources };
          const enrichedRelationships = await deps.ai.inferRelationships(
            { ir, resources: enrichedResources },
            req.context,
          );
          ir = { ...ir, relationships: enrichedRelationships };
          if (deps.judge) {
            // The judge takes the *final* enriched IR + the proposals so it can
            // cross-reference the two sources of truth (endpoints vs.
            // inference output). Failures inside the judge fall through to
            // its own fallback verdict — we never let it break ingestion.
            const [resVerdict, relVerdict] = await Promise.all([
              deps.judge.judgeResourceInference(
                { ir, proposedResources: enrichedResources },
                req.context,
              ),
              deps.judge.judgeRelationshipInference(
                { ir, proposedRelationships: enrichedRelationships },
                req.context,
              ),
            ]);
            judge = { resources: resVerdict, relationships: relVerdict };
          }
        } catch (err) {
          // Distinguish a tripped circuit — a signal the upstream has been
          // failing consistently — from an ordinary transient error. Both
          // outcomes still ship the deterministic graph; only the log line
          // and the warning differ so operators can tell one from the other.
          const message = (err as Error).message;
          const circuitOpen = /circuit open/i.test(message);
          if (circuitOpen) {
            deps.logger.warn('ingestion.ai_skipped_breaker_open', { message });
            warnings.push(
              'AI enrichment skipped (upstream breaker open) — proceeding with mechanically-derived graph',
            );
          } else {
            deps.logger.warn('ingestion.ai_enrichment_failed', { message });
            warnings.push('AI enrichment failed — proceeding with mechanically-derived graph');
          }
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
      if (judge) {
        // Persist the judge report alongside the IR so `/v1/projects/:slug/ir/:id`
        // consumers can fetch review context by convention. This is the "meta"
        // surface for the IR artifact — the DB `artifacts` table doesn't hold
        // rows for IR/graph, so storage is the durable home for the verdict.
        await deps.storage.put(
          `projects/${req.projectSlug}/judge/${irId}.json`,
          JSON.stringify(judge),
          { contentType: 'application/json' },
        );
      }

      return {
        irId,
        graphId,
        ir,
        graph,
        warnings,
        judge,
        judgeThreshold: deps.judge?.threshold,
      };
    },
  };
}
