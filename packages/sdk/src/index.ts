import { CarbonError, createLogger, type Logger } from '@carbon/core';
import { BehaviorGraphBuilder } from '@carbon/graph';
import { createDefaultParserRegistry, createParserContext, type ParserInput } from '@carbon/parser';
import { createRuntime, type Runtime } from '@carbon/runtime';
import { InMemoryStateEngine, type StateEngine, type StateSnapshot } from '@carbon/state';
import type { AiCapabilities, AiJudge, JudgeVerdict } from '@carbon/ai';

/**
 * SDK version. Kept in sync with `packages/sdk/package.json` by hand — the
 * value is small and stable, and reaching for a package.json import here
 * would drag ESM JSON-import config into every consumer.
 */
export const SDK_VERSION = '0.1.0';

export interface ReplicaUsage {
  ai_call: number;
  requests: number;
  snapshot_saved: number;
  snapshot_restored: number;
}

export interface ReplicaMetrics {
  readonly server: 'sdk';
  readonly version: string;
  readonly startedAt: string;
  readonly uptimeMs: number;
  readonly ai: {
    readonly threshold: number | null;
    readonly minScore: number | null;
    readonly needsReview: boolean;
  };
}

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
  /**
   * Throw a CarbonError when the judge's `minScore` is below `threshold`
   * (defaults to `aiJudgeThreshold`). No-op when the replica ran without a
   * judge (`aiQuality === null`) — assertions must not fire on data that
   * wasn't measured. Handy in test suites: `replica.assertQuality()` after
   * `carbon.emulate({ ai })` gates the run on the same threshold the
   * judge used.
   */
  assertQuality(threshold?: number): void;
  /**
   * In-memory usage counters for this replica. Reset by {@link stop}.
   */
  usage(): Promise<ReplicaUsage>;
  /**
   * Synchronous, allocation-free health/metrics summary for tests.
   */
  metrics(): ReplicaMetrics;
  /**
   * Close the underlying runtime and reset the usage counters. Prefer this
   * over {@link close} in test suites where you want a clean slate between
   * cases.
   */
  stop(): Promise<void>;
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
    const counters: ReplicaUsage = {
      ai_call: 0,
      requests: 0,
      snapshot_saved: 0,
      snapshot_restored: 0,
    };
    if (opts.ai) {
      const enrichedResources = await opts.ai.capabilities.inferResources({ ir });
      counters.ai_call += 1;
      ir = { ...ir, resources: enrichedResources };
      const enrichedRelationships = await opts.ai.capabilities.inferRelationships({
        ir,
        resources: enrichedResources,
      });
      counters.ai_call += 1;
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
        counters.ai_call += 2;
        aiQuality = { resources, relationships };
        aiJudgeThreshold = opts.ai.judgeThreshold ?? opts.ai.judge.threshold ?? 0.75;
      }
    }

    const graph = new BehaviorGraphBuilder().build(ir);
    const state = new InMemoryStateEngine();
    if (opts.snapshot) await state.restore(opts.snapshot);

    const runtime = await createRuntime({ ir, graph, state, logger });
    // `requests` counts user-facing HTTP hits — the runtime's own control
    // routes (`/__carbon/*`) exist for introspection and should not inflate
    // the metric that tests use to gate quality checks.
    runtime.app.addHook('onRequest', async (req) => {
      if (typeof req.url === 'string' && req.url.startsWith('/__carbon/')) return;
      counters.requests += 1;
    });
    const url = await runtime.listen(opts.port ?? 8787, opts.host ?? '127.0.0.1');
    const startedAt = new Date();

    const minScore = pickMinScore(aiQuality);
    const needsReview =
      aiQuality !== null &&
      aiJudgeThreshold !== null &&
      minScore !== null &&
      minScore < aiJudgeThreshold;

    let stopped = false;
    const replica: Replica = {
      url,
      runtime,
      state: {
        engine: state,
        reset: () => state.reset(),
      },
      snapshot: {
        save: async () => {
          const snap = await state.snapshot();
          counters.snapshot_saved += 1;
          return snap;
        },
        restore: async (snap) => {
          await state.restore(snap);
          counters.snapshot_restored += 1;
        },
      },
      close: () => runtime.close(),
      aiQuality,
      aiJudgeThreshold,
      assertQuality(threshold) {
        if (aiQuality === null) return;
        const gate = threshold ?? aiJudgeThreshold ?? 0;
        const min = pickMinScore(aiQuality);
        if (min === null) return;
        if (min < gate) {
          throw new CarbonError({
            code: 'CARBON_AI_QUALITY_BELOW_THRESHOLD',
            message: `AI quality below threshold: minScore ${min} < ${gate}`,
            details: {
              minScore: min,
              threshold: gate,
              resources: aiQuality.resources,
              relationships: aiQuality.relationships,
            },
            expose: true,
          });
        }
      },
      usage: async () => ({ ...counters }),
      metrics: () => ({
        server: 'sdk',
        version: SDK_VERSION,
        startedAt: startedAt.toISOString(),
        uptimeMs: Date.now() - startedAt.getTime(),
        ai: {
          threshold: aiJudgeThreshold,
          minScore,
          needsReview,
        },
      }),
      async stop() {
        if (stopped) return;
        stopped = true;
        counters.ai_call = 0;
        counters.requests = 0;
        counters.snapshot_saved = 0;
        counters.snapshot_restored = 0;
        await runtime.close();
      },
    };
    return replica;
  },
};

function pickMinScore(q: ReplicaAiQuality | null): number | null {
  if (q === null) return null;
  const scores: number[] = [];
  if (typeof q.resources.score === 'number') scores.push(q.resources.score);
  if (typeof q.relationships.score === 'number') scores.push(q.relationships.score);
  if (scores.length === 0) return null;
  return Math.min(...scores);
}

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
