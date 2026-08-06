import { CarbonError } from '@carbon/core';
import type { Logger } from '@carbon/core';
import type {
  AiProvider,
  AiProviderOptions,
  CompletionRequest,
  CompletionResponse,
  StructuredRequest,
} from '../provider.js';
import { extractJson } from '../util.js';

/**
 * Native Anthropic Messages API provider. Kept fetch-based; the SDK is heavy
 * and we do not need its streaming semantics inside Carbon's ingestion path.
 */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly defaultModel: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly logger: Logger;

  constructor(opts: AiProviderOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://api.anthropic.com/v1';
    this.defaultModel = opts.defaultModel ?? 'claude-opus-5';
    this.logger = opts.logger.child({ provider: this.name });
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: req.model ?? this.defaultModel,
        system: req.system,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: req.temperature ?? 0.2,
        max_tokens: req.maxTokens ?? 1024,
      }),
      signal: req.signal,
    });
    if (!res.ok) {
      throw new CarbonError({
        code: 'CARBON_AI_PROVIDER_FAILED',
        message: `Anthropic request failed: ${res.status}`,
      });
    }
    const json = (await res.json()) as {
      model: string;
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };
    const text = json.content.map((c) => c.text ?? '').join('');
    return {
      text,
      model: json.model,
      usage: {
        promptTokens: json.usage?.input_tokens ?? 0,
        completionTokens: json.usage?.output_tokens ?? 0,
        totalTokens: (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0),
      },
    };
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    const res = await this.complete({
      ...req,
      system:
        (req.system ?? '') +
        '\nRespond ONLY with a JSON document matching the requested schema. Do not include prose.',
      messages: [
        {
          role: 'user',
          content: `${req.instruction}\n\nInput:\n${JSON.stringify(req.input)}`,
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
