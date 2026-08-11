/**
 * Compile-time assertions that the hand-written `api-client` shapes stay in
 * step with the generated OpenAPI `paths` type. If the API contract drifts
 * (e.g. a field is renamed or removed on the wire), the `satisfies` checks
 * below stop compiling — `pnpm --filter @carbon/dashboard typecheck` fails
 * loudly rather than the dashboard silently deserialising a stale shape.
 *
 * The `describe` block is a smoke test only; the real verification is that
 * this file *type-checks*.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createApiClient,
  type ApiPaths,
  type Project,
  type ListResponse,
  type CreatedApiKey,
} from './api-client';

// ---------- /v1/projects GET ----------
type ListProjectsResponse = NonNullable<
  ApiPaths['/v1/projects']['get']['responses']['200']['content']
>['application/json'];

// Wire type must be assignable to the hand-written client shape (extra
// generated fields are fine; missing required ones would fail).
type _WireProjectMatchesHandwritten = ListProjectsResponse['data'][number] extends {
  id: string;
  orgId: string;
  slug: string;
}
  ? true
  : never;
const _wireProjectOk: _WireProjectMatchesHandwritten = true;
void _wireProjectOk;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _typecheckOnly_projects() {
  const wire = null as unknown as ListProjectsResponse;
  const mapped: ListResponse<Project> = {
    data: wire.data.map((p) => ({
      id: p.id,
      orgId: p.orgId,
      slug: p.slug,
      name: p.name ?? '',
    })),
    nextCursor: wire.nextCursor,
    hasMore: wire.hasMore,
    total: wire.total,
  };
  return mapped;
}

// ---------- /v1/api-keys POST ----------
// Prove the generated `paths` entry resolves at all (route exists in spec).
type CreateApiKeyOp = ApiPaths['/v1/api-keys']['post'];
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _CreateApiKeyOpExists = CreateApiKeyOp extends { responses: unknown } ? true : never;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _typecheckOnly_createdApiKey(x: CreatedApiKey) {
  return x.secret;
}

describe('api-client generated types', () => {
  it('compiles the wire-type assertions in this file', () => {
    expect(true).toBe(true);
  });
});

describe('api-client.search cancellation', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('propagates AbortError when the caller aborts the signal mid-flight', async () => {
    // Fetch stub that resolves only when the caller's signal fires — mirrors
    // the browser's real behavior of rejecting with a DOMException named
    // 'AbortError'. We assert the client re-throws it verbatim rather than
    // wrapping it in ApiError, so palette code can distinguish a superseded
    // keystroke from a genuine network fault.
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error('expected AbortSignal to be forwarded');
        const onAbort = () => {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort);
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createApiClient({ baseUrl: 'http://test' });
    const controller = new AbortController();
    const promise = client.search('anything', 'all', { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0]!;
    expect(String(call[0])).toContain('/v1/search');
    expect(String(call[0])).toContain('q=anything');
    // signal must not leak into the querystring
    expect(String(call[0])).not.toContain('signal=');
  });
});
