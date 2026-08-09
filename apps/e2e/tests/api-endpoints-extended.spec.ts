import { test, expect, request as pwRequest } from '@playwright/test';

const API_URL = 'http://127.0.0.1:4000';

/**
 * Iterates over every GET path in /openapi.json and hits it, substituting
 * any `{param}` placeholders with a fixture value and appending `?orgId=`
 * where useful. Skips paths that clearly need a real resource id we can't
 * fabricate. The assertion is coarse — no 5xx — so the sweep is really a
 * "did the route wire itself up correctly" check, not a schema audit.
 */

const FIXTURE_PARAMS: Record<string, string> = {
  id: 'org_test',
  orgId: 'org_test',
  organizationId: 'org_test',
  sessionId: 'nonexistent-session',
  slug: 'nonexistent-slug',
  name: 'nonexistent-name',
  runId: 'nonexistent-run',
  projectSlug: 'nonexistent-project',
  userId: 'nonexistent-user',
  presetId: 'nonexistent-preset',
  eventId: 'nonexistent-event',
  keyId: 'nonexistent-key',
  emulatorId: 'nonexistent-emu',
  webhookId: 'nonexistent-webhook',
  providerId: 'nonexistent-provider',
  invitationId: 'nonexistent-inv',
  snapshotName: 'nonexistent-snap',
  artifactId: 'nonexistent-artifact',
};

// Some endpoints intentionally return before doing DB work but still bind
// route-scoped external resources (e.g. long-poll subscriptions, SSE) that
// don't play nicely inside a request-fixture 30s timeout. Skip them so the
// sweep runs quickly and deterministically.
const SKIP_PATH_SUBSTRINGS = [
  '/stream', // SSE
  '/events/stream',
  '/watch',
  '/docs',
];

interface OpenApiSpec {
  paths: Record<string, Record<string, unknown>>;
}

test('every GET endpoint answers with 200 or a 4xx (no 5xx)', async () => {
  const ctx = await pwRequest.newContext();
  const specRes = await ctx.get(`${API_URL}/openapi.json`);
  expect(specRes.status()).toBe(200);
  const spec = (await specRes.json()) as OpenApiSpec;

  const paths = Object.entries(spec.paths ?? {});
  expect(paths.length).toBeGreaterThan(0);

  const failures: Array<{ path: string; status: number }> = [];
  const seen: string[] = [];

  for (const [pathTemplate, ops] of paths) {
    if (!ops || typeof ops !== 'object') continue;
    if (!('get' in ops)) continue;
    if (SKIP_PATH_SUBSTRINGS.some((s) => pathTemplate.includes(s))) continue;

    const url = substituteParams(pathTemplate);
    const withOrg = url.includes('?')
      ? `${url}&orgId=org_test`
      : `${url}?orgId=org_test`;

    const target = `${API_URL}${withOrg}`;
    seen.push(target);
    const res = await ctx.get(target, { timeout: 15_000 }).catch(() => null);
    if (!res) {
      failures.push({ path: pathTemplate, status: 0 });
      continue;
    }
    const status = res.status();
    // Anything 2xx or 4xx is acceptable — the route replied deterministically.
    // 5xx means it blew up.
    if (status >= 500) {
      failures.push({ path: pathTemplate, status });
    }
  }

  await ctx.dispose();

  expect(seen.length).toBeGreaterThan(0);
  expect(failures, `5xx responses from GET endpoints: ${JSON.stringify(failures)}`).toEqual([]);
});

function substituteParams(pathTemplate: string): string {
  return pathTemplate.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const val = FIXTURE_PARAMS[name] ?? 'nonexistent';
    return encodeURIComponent(val);
  });
}
