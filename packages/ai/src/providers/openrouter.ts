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
 * OpenRouter provider — a single API for many upstream models. Default choice
 * because it lets Carbon users bring any model without provider-specific code.
 * Fetch-based (no SDK), so the runtime footprint stays tiny.
 */
export class OpenRouterProvider implements AiProvider {
  readonly name = 'openrouter';
  readonly defaultModel: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly logger: Logger;

  constructor(opts: AiProviderOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://openrouter.ai/api/v1';
    this.defaultModel = opts.defaultModel ?? 'anthropic/claude-opus-5';
    this.logger = opts.logger.child({ provider: this.name });
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const messages = req.system
      ? [{ role: 'system', content: req.system }, ...req.messages]
      : [...req.messages];
    const body = {
      model: req.model ?? this.defaultModel,
      messages,
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxTokens,
    };
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      throw new CarbonError({
        code: 'CARBON_AI_PROVIDER_FAILED',
        message: `OpenRouter request failed: ${res.status}`,
        details: { status: res.status, statusText: res.statusText },
      });
    }
    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    const first = json.choices[0];
    if (!first) {
      throw new CarbonError({
        code: 'CARBON_AI_PROVIDER_FAILED',
        message: 'OpenRouter returned no choices',
      });
    }
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
          content: `${req.instruction}\n\nInput:\n${JSON.stringify(req.input)}\n\nRespond ONLY with JSON matching the schema. No commentary.`,
        },
      ],
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(res.text));
    } catch (cause) {
      throw new CarbonError({
        code: 'CARBON_AI_PROVIDER_FAILED',
        message: 'AI response was not valid JSON',
        cause,
      });
    }
    const validated = req.schema.safeParse(parsed);
    if (!validated.success) {
      this.logger.warn('ai.structured.schema_mismatch', { issues: validated.error.issues });
      throw new CarbonError({
        code: 'CARBON_AI_PROVIDER_FAILED',
        message: 'AI response did not match schema',
        details: { issues: validated.error.issues },
      });
    }
    return validated.data;
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
      'http-referer': 'https://carbon.dev',
      'x-title': 'Carbon',
    };
  }
}

