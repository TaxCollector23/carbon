import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { CompletionRequest, CompletionResponse } from './provider.js';

/**
 * Wrap a provider's `complete()` call in an OpenTelemetry span with attributes
 * useful for cost / latency dashboards. When no OTel SDK is registered this
 * uses the no-op ProxyTracer and adds ~microseconds of overhead — safe to keep
 * on unconditionally.
 */
const tracer = trace.getTracer('@carbon/ai');

export function withAiSpan(
  providerName: string,
  req: CompletionRequest,
  fn: () => Promise<CompletionResponse>,
): Promise<CompletionResponse> {
  return tracer.startActiveSpan('ai.complete', async (span) => {
    span.setAttribute('ai.provider', providerName);
    if (req.model) span.setAttribute('ai.model', req.model);
    try {
      const result = await fn();
      span.setAttribute('ai.model', result.model);
      span.setAttribute('ai.prompt_tokens', result.usage.promptTokens);
      span.setAttribute('ai.completion_tokens', result.usage.completionTokens);
      span.setAttribute('ai.total_tokens', result.usage.totalTokens);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}
