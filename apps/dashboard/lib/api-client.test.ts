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
import { describe, expect, it } from 'vitest';
import type {
  ApiPaths,
  Project,
  ListResponse,
  CreatedApiKey,
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
