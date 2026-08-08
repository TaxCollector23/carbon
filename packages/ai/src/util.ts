import { CarbonError } from '@carbon/core';

/**
 * Extract a JSON object from a model's text response. Models frequently wrap
 * JSON in ```json fences or prefix it with prose; a raw JSON.parse would fail
 * on those. This is best-effort — the caller should still Zod-validate the
 * parsed result.
 */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return text.trim();
}

// ─── Reliability wrappers around AI provider calls ────────────────────────
//
// Providers upstream of Carbon are flaky in three distinctive ways:
//
//   1. Latency spikes ("model warming"). A per-call timeout keeps the caller
//      predictable.
//   2. Intermittent 5xx / socket resets. Retry with jittered backoff clears
//      the vast majority.
//   3. Sustained outages. A circuit breaker keeps us from hammering a dead
//      dependency and lets the caller degrade gracefully (skip AI, keep
//      shipping the deterministic parse).
//
// The wrappers are composable and side-effect-free per call: each returns a
// function that runs the underlying `fn` under its own policy. The provider
// composes them as `withCircuitBreaker(withRetryJitter(withTimeout(fn)))`.

export const CIRCUIT_OPEN_CODE = 'CARBON_AI_CIRCUIT_OPEN';

export interface CircuitBreakerOptions {
  /** Consecutive failures required to trip the breaker. Default 5. */
  readonly failureThreshold?: number;
  /** How long the breaker stays open before probing again, ms. Default 30_000. */
  readonly cooldownMs?: number;
  /** Optional label used in error messages / telemetry. */
  readonly label?: string;
}

export interface CircuitBreaker<Args extends unknown[], T> {
  (...args: Args): Promise<T>;
  readonly state: () => 'closed' | 'open' | 'half-open';
  readonly reset: () => void;
}

/**
 * Wrap `fn` with a simple state-machine breaker.
 *
 * closed → (N consecutive failures) → open → (cooldown) → half-open
 * half-open → (one success) → closed | (one failure) → open (renewed cooldown)
 *
 * A rejected call while `open` throws `CARBON_AI_CIRCUIT_OPEN` without ever
 * calling `fn`, so an outage doesn't multiply the upstream error rate.
 */
export function withCircuitBreaker<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
  opts: CircuitBreakerOptions = {},
): CircuitBreaker<Args, T> {
  const threshold = opts.failureThreshold ?? 5;
  const cooldown = opts.cooldownMs ?? 30_000;
  const label = opts.label ?? 'ai';
  let failures = 0;
  let openUntil = 0;
  let state: 'closed' | 'open' | 'half-open' = 'closed';

  const wrapped = (async (...args: Args) => {
    const now = Date.now();
    if (state === 'open') {
      if (now < openUntil) {
        throw new CarbonError({
          code: 'CARBON_AI_PROVIDER_FAILED',
          message: `${label}: circuit open — upstream marked unhealthy, retry after ${Math.max(0, openUntil - now)}ms`,
          details: { carbonCode: CIRCUIT_OPEN_CODE, retryAfterMs: openUntil - now },
          expose: true,
        });
      }
      state = 'half-open';
    }
    try {
      const result = await fn(...args);
      failures = 0;
      state = 'closed';
      return result;
    } catch (err) {
      failures += 1;
      if (failures >= threshold || state === 'half-open') {
        state = 'open';
        openUntil = Date.now() + cooldown;
      }
      throw err;
    }
  }) as CircuitBreaker<Args, T>;

  (wrapped as unknown as { state: () => typeof state }).state = () => state;
  (wrapped as unknown as { reset: () => void }).reset = () => {
    failures = 0;
    openUntil = 0;
    state = 'closed';
  };
  return wrapped;
}

/**
 * Cap the wall-clock duration of `fn`. Rejects with `CARBON_TIMEOUT` if the
 * budget is exceeded — leaves any in-flight I/O to finish on its own (no
 * AbortSignal wiring here; callers who want cancellation should also pass a
 * signal through the provider request).
 */
export function withTimeout<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
  ms: number,
): (...args: Args) => Promise<T> {
  return (...args: Args) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new CarbonError({
            code: 'CARBON_TIMEOUT',
            message: `ai: call exceeded ${ms}ms timeout`,
            expose: true,
          }),
        );
      }, ms);
      timer.unref?.();
      fn(...args)
        .then((v) => {
          clearTimeout(timer);
          resolve(v);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
}

export interface RetryJitterOptions {
  /** Total attempts including the first. Default 3. */
  readonly attempts?: number;
  /** Base backoff, ms. Default 250. */
  readonly baseMs?: number;
  /** Optional predicate — return false to stop retrying (e.g. 4xx). */
  readonly shouldRetry?: (err: unknown) => boolean;
}

/**
 * Exponential backoff with full jitter. Skips retry for
 * `CARBON_AI_CIRCUIT_OPEN` — if the breaker is open the whole point is to
 * stop calling the upstream, and for `CARBON_TIMEOUT` returned by
 * `withTimeout` retrying is fine.
 */
export function withRetryJitter<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
  opts: RetryJitterOptions = {},
): (...args: Args) => Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const base = Math.max(1, opts.baseMs ?? 250);
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;

  return async (...args: Args): Promise<T> => {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn(...args);
      } catch (err) {
        lastErr = err;
        if (i === attempts - 1) break;
        if (!shouldRetry(err)) break;
        const delay = Math.floor(base * 2 ** i * (0.5 + Math.random()));
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, delay);
          t.unref?.();
        });
      }
    }
    throw lastErr;
  };
}

function defaultShouldRetry(err: unknown): boolean {
  if (err instanceof CarbonError) {
    // Never re-try into an open breaker or a validated schema-mismatch — those
    // are stable-failure states.
    const carbonCode = (err.details as { carbonCode?: string })?.carbonCode;
    if (carbonCode === CIRCUIT_OPEN_CODE) return false;
    if (err.code === 'CARBON_INVALID_INPUT') return false;
  }
  return true;
}

/** Type guard callers can use to skip AI enrichment when the breaker is open. */
export function isCircuitOpenError(err: unknown): boolean {
  if (!(err instanceof CarbonError)) return false;
  return (err.details as { carbonCode?: string })?.carbonCode === CIRCUIT_OPEN_CODE;
}
