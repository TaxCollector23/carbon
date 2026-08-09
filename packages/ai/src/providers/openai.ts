import { CarbonError } from '@carbon/core';
import type { Logger } from '@carbon/core';
import type {
  AiProvider,
  AiProviderOptions,
  CompletionRequest,
  CompletionResponse,
  StructuredRequest,
} from '../provider.js';
import { extractJson, withCircuitBreaker, withRetryJitter, withTimeout } from '../util.js';
import { withAiSpan } from '../tracing.js';

/** OpenAI Chat Completions provider. */
export class OpenAIProvider implements AiProvider {
  readonly name = 'openai';
  readonly defaultModel: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly logger: Logger;

  private readonly guarded: (req: CompletionRequest) => Promise<CompletionResponse>;
  private readonly onUsage?: AiProviderOptions['onUsage'];

  constructor(opts: AiProviderOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://api.openai.com/v1';
    this.defaultModel = opts.defaultModel ?? 'gpt-4o';
    this.logger = opts.logger.child({ provider: this.name });
    this.onUsage = opts.onUsage;
    // 15s timeout, 3 attempts, breaker at 5 consecutive failures / 30s.
    this.guarded = withCircuitBreaker(
      withRetryJitter(withTimeout((req: CompletionRequest) => this.rawComplete(req), 15_000)),
      { label: 'openai' },
    );
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const start = Date.now();
    const result = await withAiSpan(this.name, req, () => this.guarded(req));
    if (this.onUsage) {
      try {
        this.onUsage({
          provider: this.name,
          model: result.model,
          usage: result.usage,
          latencyMs: Date.now() - start,
          context: req.context,
        });
      } catch (err) {
        this.logger.warn('ai.usage_callback_failed', { message: (err as Error).message });
      }
    }
    return result;
  }

  private async rawComplete(req: CompletionRequest): Promise<CompletionResponse> {
    const messages = req.system
      ? [{ role: 'system' as const, content: req.system }, ...req.messages]
      : [...req.messages];
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: req.model ?? this.defaultModel,
        messages,
        temperature: req.temperature ?? 0.2,
        max_tokens: req.maxTokens,
      }),
      signal: req.signal,
    });
    if (!res.ok) {
      throw new CarbonError({
        code: 'CARBON_AI_PROVIDER_FAILED',
        message: `OpenAI request failed: ${res.status}`,
      });
    }
    const json = (await res.json()) as {
      model: string;
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    const first = json.choices[0];
    if (!first)
      throw new CarbonError({ code: 'CARBON_AI_PROVIDER_FAILED', message: 'No choices returned' });
    return {
      text: first.message.content,
      model: json.model,
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
        totalTokens: json.usage?.total_tokens ?? 0,
      },
    };
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    const res = await this.complete({
      ...req,
      messages: [
        {
          role: 'user',
          content: `${req.instruction}\n\nInput:\n${JSON.stringify(req.input)}\n\nRespond with JSON only.`,
        },
      ],
    });
    const parsed = req.schema.safeParse(JSON.parse(extractJson(res.text)));
    if (!parsed.success) {
      this.logger.warn('ai.structured.schema_mismatch', { issues: parsed.error.issues });
      throw new CarbonError({
        code: 'CARBON_AI_PROVIDER_FAILED',
        message: 'AI response did not match schema',
      });
    }
    return parsed.data;
  }
}
