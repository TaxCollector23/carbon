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

/** Google Gemini generative-language provider. */
export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  readonly defaultModel: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly logger: Logger;

  private readonly guarded: (req: CompletionRequest) => Promise<CompletionResponse>;
  private readonly onUsage?: AiProviderOptions['onUsage'];

  constructor(opts: AiProviderOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    this.defaultModel = opts.defaultModel ?? 'gemini-2.0-pro';
    this.logger = opts.logger.child({ provider: this.name });
    this.onUsage = opts.onUsage;
    this.guarded = withCircuitBreaker(
      withRetryJitter(withTimeout((req: CompletionRequest) => this.rawComplete(req), 15_000)),
      { label: 'gemini' },
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
        });
      } catch (err) {
        this.logger.warn('ai.usage_callback_failed', { message: (err as Error).message });
      }
    }
    return result;
  }

  private async rawComplete(req: CompletionRequest): Promise<CompletionResponse> {
    const model = req.model ?? this.defaultModel;
    const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;
    const contents = req.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: req.system ? { parts: [{ text: req.system }] } : undefined,
        generationConfig: {
          temperature: req.temperature ?? 0.2,
          maxOutputTokens: req.maxTokens,
        },
      }),
      signal: req.signal,
    });
    if (!res.ok) {
      throw new CarbonError({
        code: 'CARBON_AI_PROVIDER_FAILED',
        message: `Gemini request failed: ${res.status}`,
      });
    }
    const json = (await res.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
    };
    const text = json.candidates[0]?.content.parts.map((p) => p.text).join('') ?? '';
    return {
      text,
      model,
      usage: {
        promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens:
          (json.usageMetadata?.promptTokenCount ?? 0) +
          (json.usageMetadata?.candidatesTokenCount ?? 0),
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
