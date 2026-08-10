/**
 * @carbon/client — officially-generated typed client for the Carbon
 * control-plane API.
 *
 * Everything routed through this module derives from the OpenAPI spec
 * published by `apps/api`; there are no hand-written per-endpoint
 * methods. To upgrade to a newer spec, run `pnpm --filter @carbon/client
 * codegen` (or the root-level `pnpm client:codegen`).
 *
 * Quickstart:
 * ```ts
 * import { createCarbonClient } from '@carbon/client';
 *
 * const carbon = createCarbonClient({
 *   baseUrl: 'http://localhost:4000',
 *   apiKey: process.env.CARBON_API_KEY,
 * });
 *
 * const { data, error } = await carbon.GET('/v1/projects');
 * if (error) throw new CarbonError(error);
 * console.log(data);
 * ```
 */

import createClient, { type Client, type Middleware } from 'openapi-fetch';
import type { paths } from './api-types.gen';

export interface CreateCarbonClientOptions {
  /** Base URL of the Carbon API (no trailing slash). */
  baseUrl: string;
  /**
   * Optional CLI/service API key. When provided, every request is sent with
   * `Authorization: Bearer <key>`. Cookies/other auth mechanisms still work
   * via the underlying fetch.
   */
  apiKey?: string;
  /**
   * Optional fetch implementation. Defaults to the global `fetch` — useful
   * for injecting a mock in tests or a polyfill in older Node runtimes.
   */
  fetch?: typeof fetch;
  /**
   * Extra headers merged into every request (after the API-key header, so
   * callers can override).
   */
  headers?: Record<string, string>;
}

export type CarbonClient = Client<paths>;

/**
 * Build a typed client. All methods (`GET`, `POST`, `PUT`, `PATCH`,
 * `DELETE`, …) accept an OpenAPI path string and return a discriminated
 * `{ data, error, response }` union, so callers never have to remember
 * status codes or response shapes.
 */
export function createCarbonClient(opts: CreateCarbonClientOptions): CarbonClient {
  const c = createClient<paths>({
    baseUrl: opts.baseUrl,
    fetch: opts.fetch,
    headers: opts.headers,
  });

  if (opts.apiKey) {
    const authMiddleware: Middleware = {
      onRequest({ request }) {
        request.headers.set('authorization', `Bearer ${opts.apiKey}`);
        return request;
      },
    };
    c.use(authMiddleware);
  }

  return c;
}

/**
 * Structured error you can throw when an `openapi-fetch` call returns a
 * non-2xx response. Wraps the parsed error body plus the raw Response so
 * callers can inspect headers, status, etc.
 */
export class CarbonError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: unknown;
  public readonly response?: Response;

  constructor(
    payload: unknown,
    response?: Response,
    message?: string,
  ) {
    const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
    const status =
      typeof p.status === 'number'
        ? (p.status as number)
        : response?.status ?? 0;
    const code =
      typeof p.code === 'string' ? (p.code as string) : 'CARBON_ERROR';
    const msg =
      message ??
      (typeof p.message === 'string' ? (p.message as string) : `Carbon API error ${status}`);
    super(msg);
    this.name = 'CarbonError';
    this.status = status;
    this.code = code;
    this.details = p.details ?? payload;
    this.response = response;
  }
}

export type { paths, components, operations } from './api-types.gen';
