/**
 * SDK + AI example — boot a replica whose IR has been enriched by
 * `AiCapabilities` and adversarially reviewed by `AiJudge`, then gate the
 * run on `replica.assertQuality()`.
 *
 * If `CARBON_AI_API_KEY` is set the example will wire up an Anthropic
 * provider. Otherwise it falls back to a fully offline mock provider so the
 * example is runnable in CI, on a plane, or in a fresh clone — no external
 * services required.
 *
 * Run with: `pnpm --filter @carbon/example-sdk-with-ai dev`
 */
import { fileURLToPath } from 'node:url';
import { CarbonError, createLogger } from '@carbon/core';
import {
  AiCapabilities,
  AiJudge,
  AnthropicProvider,
  type AiProvider,
  type CompletionRequest,
  type CompletionResponse,
  type StructuredRequest,
} from '@carbon/ai';
import { carbon } from '@carbon/sdk';

/**
 * Fully offline provider used when no `CARBON_AI_API_KEY` is present.
 * It inspects the instruction string to decide which canned response to
 * return, then hands the object to the caller's Zod schema so downstream
 * type-narrowing behaves exactly like a live provider.
 */
class MockAiProvider implements AiProvider {
  readonly name = 'mock';
  readonly defaultModel = 'mock-model-v1';

  async complete(_req: CompletionRequest): Promise<CompletionResponse> {
    return {
      text: 'mocked completion',
      model: this.defaultModel,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    const instruction = req.instruction.toLowerCase();
    let payload: unknown;
    if (instruction.includes('identify the underlying resources')) {
      payload = {
        resources: [{ id: 'pet', name: 'Pet', primaryKey: 'id', schema: {} }],
      };
    } else if (instruction.includes('infer ownership')) {
      payload = { relationships: [] };
    } else if (instruction.includes('adversarial reviewer')) {
      payload = {
        score: 0.9,
        issues: [],
        model: this.defaultModel,
      };
    } else {
      payload = {};
    }
    // Run the caller's schema so consumers see the same transformed shape
    // a real provider would return.
    return req.schema.parse(payload);
  }
}

function buildProvider(): AiProvider {
  const apiKey = process.env.CARBON_AI_API_KEY;
  if (!apiKey) {
    console.log('[example] CARBON_AI_API_KEY not set — using offline MockAiProvider.');
    return new MockAiProvider();
  }
  console.log('[example] CARBON_AI_API_KEY detected — using AnthropicProvider.');
  return new AnthropicProvider({
    apiKey,
    logger: createLogger({ level: 'info', pretty: true, name: 'example-ai' }),
  });
}

async function main(): Promise<void> {
  const specPath = fileURLToPath(
    new URL('../../benchmarks/fixtures/petstore.openapi.json', import.meta.url),
  );

  const provider = buildProvider();
  const capabilities = new AiCapabilities(provider);
  const judge = new AiJudge({ provider, threshold: 0.8 });

  console.log(`[example] booting replica from ${specPath} with AI enrichment`);
  const replica = await carbon.emulate({
    from: specPath,
    port: 0,
    ai: { capabilities, judge, judgeThreshold: 0.8 },
  });
  console.log(`[example] replica listening at ${replica.url}`);
  console.log('[example] AI judge threshold:', replica.aiJudgeThreshold);
  console.log('[example] AI quality:', replica.aiQuality);

  try {
    replica.assertQuality(0.8);
    console.log('[example] assertQuality passed.');
  } catch (err) {
    if (err instanceof CarbonError) {
      console.error('[example] assertQuality FAILED:', err.message);
      console.error('[example] details:', err.details);
    } else {
      throw err;
    }
  } finally {
    await replica.stop();
    console.log('[example] replica stopped.');
  }
}

main().catch((err) => {
  console.error('[example] failed:', err);
  process.exit(1);
});
