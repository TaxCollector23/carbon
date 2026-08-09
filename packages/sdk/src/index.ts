import { createLogger, type Logger } from '@carbon/core';
import { BehaviorGraphBuilder } from '@carbon/graph';
import { createDefaultParserRegistry, createParserContext, type ParserInput } from '@carbon/parser';
import { createRuntime, type Runtime } from '@carbon/runtime';
import { InMemoryStateEngine, type StateEngine, type StateSnapshot } from '@carbon/state';
import type { AiCapabilities, AiJudge, JudgeVerdict } from '@carbon/ai';

export interface EmulateAiOptions {
  /**
   * Enrich the parsed IR with AI-inferred resources/relationships. When
   * paired with `judge`, verdicts land on `replica.aiQuality`.
   */
  readonly capabilities: AiCapabilities;
  readonly judge?: AiJudge;
  /**
   * Minimum acceptable judge score. Echoed onto the returned
   * `Replica.aiJudgeThreshold` so consumers can decide whether to promote
   * without re-computing the gate. Defaults to the judge's own threshold
   * when omitted (which itself defaults to 0.75).
   */
  readonly judgeThreshold?: number;
}

export interface EmulateOptions {
  /** API source path/URL, recorded traffic, or preloaded ParserInput. */
  readonly from: ParserInput | string;
  readonly port?: number;
  readonly host?: string;
  readonly snapshot?: StateSnapshot | null;
  readonly logger?: Logger;
  /** Opt in to AI enrichment + adversarial judging during emulate(). */
  readonly ai?: EmulateAiOptions;
}

export interface ReplicaAiQuality {
  readonly resources: JudgeVerdict;
  readonly relationships: JudgeVerdict;
}

export interface Replica {
  readonly url: string;
  readonly state: {
    reset(): Promise<void>;
    engine: StateEngine;
  };
  readonly snapshot: {
    save(name: string): Promise<StateSnapshot>;
    restore(snapshot: StateSnapshot): Promise<void>;
  };
  close(): Promise<void>;
  readonly runtime: Runtime;
  /**
   * Judge verdicts on AI-inferred resources/relationships. `null` when the
   * replica was built without AI enrichment or without a judge.
   */
  readonly aiQuality: ReplicaAiQuality | null;
  /**
   * The judge threshold this replica was evaluated against — `null` when no
   * judge ran. Consumers gate on `aiQuality?.resources.score >= aiJudgeThreshold`.
   */
  readonly aiJudgeThreshold: number | null;
}

/**
 * The programmatic entry point. Composes parser → graph → runtime into a
 * single Replica object suitable for test suites and dev servers.
 */
export const carbon = {
  async emulate(opts: EmulateOptions): Promise<Replica> {
    const logger = opts.logger ?? createLogger({ level: 'info', pretty: true, name: 'sdk' });

    const parsers = createDefaultParserRegistry();

    const input: ParserInput =
      typeof opts.from === 'string' ? await loadInput(opts.from) : opts.from;
    const ctx = createParserContext(logger);
    let ir = await parsers.parse(input, ctx);

    // AI enrichment is opt-in and runs before the graph is built, so any
    // inferred resources/relationships flow through the rest of the pipeline
    // unchanged. Judge verdicts are computed on the *post-enrichment* IR so
    // they cross-reference the same shape the runtime will serve.
    let aiQuality: ReplicaAiQuality | null = null;
    let aiJudgeThreshold: number | null = null;
    if (opts.ai) {
      const enrichedResources = await opts.ai.capabilities.inferResources({ ir });
      ir = { ...ir, resources: enrichedResources };
      const enrichedRelationships = await opts.ai.capabilities.inferRelationships({
        ir,
        resources: enrichedResources,
      });
      ir = { ...ir, relationships: enrichedRelationships };
      if (opts.ai.judge) {
        const [resources, relationships] = await Promise.all([
          opts.ai.judge.judgeResourceInference({
            ir,
            proposedResources: enrichedResources,
          }),
          opts.ai.judge.judgeRelationshipInference({
            ir,
            proposedRelationships: enrichedRelationships,
          }),
        ]);
        aiQuality = { resources, relationships };
        aiJudgeThreshold = opts.ai.judgeThreshold ?? opts.ai.judge.threshold ?? 0.75;
      }
    }

    const graph = new BehaviorGraphBuilder().build(ir);
    const state = new InMemoryStateEngine();
    if (opts.snapshot) await state.restore(opts.snapshot);

    const runtime = await createRuntime({ ir, graph, state, logger });
    const url = await runtime.listen(opts.port ?? 8787, opts.host ?? '127.0.0.1');

    return {
      url,
      runtime,
      state: {
        engine: state,
        reset: () => state.reset(),
      },
      snapshot: {
        save: async () => state.snapshot(),
        restore: (snap) => state.restore(snap),
      },
      close: () => runtime.close(),
      aiQuality,
      aiJudgeThreshold,
    };
  },
};

async function loadInput(source: string): Promise<ParserInput> {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const res = await fetch(source);
    const text = await res.text();
    return { kind: 'text', content: text };
  }
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(source, 'utf8');
  try {
    return { kind: 'json', content: JSON.parse(text) };
  } catch {
    return { kind: 'text', content: text };
  }
}
