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

/**
 * Local OpenAI-compatible provider — Ollama, llama.cpp server, LM Studio, or
 * any endpoint that speaks the OpenAI chat completions shape. Lets Carbon run
 * fully air-gapped once ingestion has been done.
 */
export class LocalProvider implements AiProvider {
  readonly name = 'local';
  readonly defaultModel: string;
  private readonly baseUrl: string;
  private readonly logger: Logger;

  private readonly guarded: (req: CompletionRequest) => Promise<CompletionResponse>;
  private readonly onUsage?: AiProviderOptions['onUsage'];

  constructor(opts: AiProviderOptions) {
    this.baseUrl = opts.baseUrl ?? 'http://127.0.0.1:11434/v1';
    this.defaultModel = opts.defaultModel ?? 'llama3.1';
    this.logger = opts.logger.child({ provider: this.name });
    this.onUsage = opts.onUsage;
    this.guarded = withCircuitBreaker(
      withRetryJitter(withTimeout((req: CompletionRequest) => this.rawComplete(req), 15_000)),
      { label: 'local' },
    );
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const start = Date.now();
    const result = await this.guarded(req);
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: req.model ?? this.defaultModel,
        messages,
        temperature: req.temperature ?? 0.2,
      }),
      signal: req.signal,
    });
    if (!res.ok) {
      throw new CarbonError({
        code: 'CARBON_AI_PROVIDER_FAILED',
        message: `Local provider request failed: ${res.status}`,
      });
    }
    const json = (await res.json()) as {
      model: string;
      choices: Array<{ message: { content: string } }>;
    };
    return {
      text: json.choices[0]?.message.content ?? '',
      model: json.model,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
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
