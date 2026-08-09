import type { FastifyInstance } from 'fastify';
import type { RouteOptions } from 'fastify';
import swagger from '@fastify/swagger';
import ScalarApiReference from '@scalar/fastify-api-reference';

/**
 * Self-documenting API surface.
 *
 * `/openapi.json` — machine-readable spec generated from route schemas.
 * `/docs`         — Scalar rendering of the same spec.
 *
 * Register BEFORE routes so Fastify's route table is fully populated when
 * the spec is materialized. Scalar is lighter than Swagger UI and looks
 * clean out of the box.
 *
 * Adding `schema: { tags, summary, description }` to *every* route by hand
 * across ~24 route modules would be a lot of churn for the same effect an
 * `onRoute` hook produces here. The mapping below is the single source of
 * truth: a URL prefix maps to exactly one tag, and each newly registered
 * route without an existing `schema.tags` inherits it. The tests in
 * `docs.test.ts` guard the mapping stays complete.
 */

/** Long-form tag descriptions rendered in Scalar's sidebar. */
export const API_TAGS: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'Projects', description: 'Organize ingested APIs and manage per-project ACLs.' },
  { name: 'Snapshots', description: 'Save and restore emulator runtime state.' },
  { name: 'Emulators', description: 'Run compiled APIs as HTTP servers with fault injection.' },
  { name: 'Api Keys', description: 'Mint, rotate, and revoke authentication credentials.' },
  { name: 'Artifacts', description: 'Immutable compiled outputs — IR, graphs, ingestion results.' },
  { name: 'Events', description: 'Audit trail of every side-effectful action.' },
  { name: 'Organizations', description: 'Tenancy, memberships, invitations.' },
  { name: 'Billing', description: 'Stripe checkout, portal, and subscription state.' },
  { name: 'SCIM', description: 'SCIM 2.0 user + group provisioning.' },
  { name: 'Chaos Presets', description: 'Reusable fault-injection profiles.' },
  { name: 'Contract', description: 'Compare a live server against an emulator contract.' },
  { name: 'Assertions', description: 'Declarative response expectations.' },
  { name: 'Graphs', description: 'Behavior graphs derived from ingested traces.' },
  { name: 'CLI Auth', description: 'Device-flow login for the `carbon` CLI.' },
  { name: 'Me', description: 'Identity introspection for the current caller.' },
  { name: 'Health', description: 'Liveness, readiness, and version.' },
  { name: 'AI Quality', description: 'LLM-graded quality signals per project.' },
  { name: 'Usage', description: 'Metered usage counters and events.' },
  { name: 'SSO', description: 'SAML/OIDC provider configuration.' },
  { name: 'Export', description: 'Bulk data export endpoints.' },
  { name: 'Share Links', description: 'Public read-only project share URLs.' },
  { name: 'Ingest', description: 'Turn OpenAPI/HAR/Postman into an IR + behavior graph.' },
];

/**
 * Ordered longest-prefix-first so `/v1/projects/:id/share-links` picks
 * `Share Links` before `Projects`. `matchTag` scans this list top to bottom
 * and returns the first hit.
 */
const TAG_PREFIXES: ReadonlyArray<[RegExp, string]> = [
  [/^\/v1\/projects\/[^/]+\/share-links/, 'Share Links'],
  [/^\/v1\/share-links/, 'Share Links'],
  [/^\/v1\/projects\/[^/]+\/ai-quality/, 'AI Quality'],
  [/^\/v1\/projects\/[^/]+\/contract-check/, 'Contract'],
  [/^\/v1\/projects\/[^/]+\/graph/, 'Graphs'],
  [/^\/v1\/projects\/[^/]+\/graphs/, 'Graphs'],
  [/^\/v1\/projects\/[^/]+\/artifacts/, 'Artifacts'],
  [/^\/v1\/projects\/[^/]+\/ir/, 'Artifacts'],
  [/^\/v1\/projects\/[^/]+\/snapshots/, 'Snapshots'],
  [/^\/v1\/projects/, 'Projects'],
  [/^\/v1\/snapshots/, 'Snapshots'],
  [/^\/v1\/emulators/, 'Emulators'],
  [/^\/v1\/api-keys/, 'Api Keys'],
  [/^\/v1\/artifacts/, 'Artifacts'],
  [/^\/v1\/events\/export/, 'Export'],
  [/^\/v1\/events/, 'Events'],
  [/^\/v1\/organizations/, 'Organizations'],
  [/^\/v1\/invitations/, 'Organizations'],
  [/^\/v1\/billing/, 'Billing'],
  [/^\/scim/, 'SCIM'],
  [/^\/v1\/chaos-presets/, 'Chaos Presets'],
  [/^\/v1\/contract/, 'Contract'],
  [/^\/v1\/assertions/, 'Assertions'],
  [/^\/v1\/graphs/, 'Graphs'],
  [/^\/v1\/cli-auth/, 'CLI Auth'],
  [/^\/v1\/me/, 'Me'],
  [/^\/v1\/ai-quality/, 'AI Quality'],
  [/^\/v1\/usage/, 'Usage'],
  [/^\/v1\/sso/, 'SSO'],
  [/^\/v1\/ingest/, 'Ingest'],
  [/^\/v1\/jobs/, 'Ingest'],
  [/^\/v1\/health/, 'Health'],
  [/^\/v1\/version/, 'Health'],
  [/^\/v1\/ping/, 'Health'],
  [/^\/health/, 'Health'],
  [/^\/ready/, 'Health'],
];

/** Return the tag for a given URL path, or `null` if no rule matches. */
export function matchTag(url: string): string | null {
  for (const [re, name] of TAG_PREFIXES) {
    if (re.test(url)) return name;
  }
  return null;
}

/**
 * Fabricate a passable summary from method + path so Scalar's route list is
 * not a wall of bare URLs. e.g. `POST /v1/projects/:id/members` becomes
 * "Create /v1/projects/:id/members".
 */
function deriveSummary(method: string, url: string): string {
  const verb = method.toUpperCase();
  const label =
    verb === 'GET'
      ? url.includes(':')
        ? 'Get'
        : 'List'
      : verb === 'POST'
        ? 'Create'
        : verb === 'PUT'
          ? 'Replace'
          : verb === 'PATCH'
            ? 'Update'
            : verb === 'DELETE'
              ? 'Delete'
              : verb;
  return `${label} ${url}`;
}

export async function registerDocs(app: FastifyInstance, release: string): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Carbon API',
        description:
          'Control plane for Carbon — projects, ingestion, emulators, snapshots, ' +
          'artifacts, org/billing, and CLI auth. Every endpoint accepts either an ' +
          'API key (`x-carbon-key`) or a Better Auth session cookie/bearer token; ' +
          'the docs and `/health` endpoints are the only routes served anonymously.',
        version: release,
        contact: {
          name: 'Carbon',
          url: 'https://carbon.dev',
          email: 'support@carbon.dev',
        },
        license: {
          name: 'Apache-2.0',
          url: 'https://www.apache.org/licenses/LICENSE-2.0',
        },
      },
      servers: [
        { url: 'http://localhost:4000', description: 'local dev' },
        { url: 'https://api.carbon.dev', description: 'production' },
      ],
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            in: 'header',
            name: 'x-carbon-key',
            description:
              'A key minted via `POST /v1/api-keys` or the `bootstrap` script. ' +
              'Prefix `ck_live_*` for production, `ck_test_*` for test envs.',
          },
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'better-auth-session',
            description:
              'A Better Auth session bearer token. Preferred for programmatic ' +
              'access from a signed-in user.',
          },
          sessionCookie: {
            type: 'apiKey',
            in: 'cookie',
            name: 'better-auth.session_token',
            description:
              'The Better Auth session cookie set by the dashboard. Used ' +
              'implicitly when the browser calls the API cross-origin with ' +
              '`credentials: "include"`.',
          },
        },
      },
      security: [{ apiKey: [] }, { bearerAuth: [] }, { sessionCookie: [] }],
      tags: [...API_TAGS],
    },
  });

  // Auto-tag every subsequently registered route based on its URL. Runs in
  // the outer plugin scope because `registerDocs` is called directly on the
  // parent `app` (not wrapped in a plugin), so the hook sees every route
  // that server.ts registers after this call.
  app.addHook('onRoute', (route: RouteOptions) => {
    // Skip HEAD/OPTIONS clones Fastify generates internally and skip the
    // Scalar/openapi UI routes themselves.
    if (route.url.startsWith('/docs') || route.url === '/openapi.json') return;

    const existing = (route.schema ?? {}) as Record<string, unknown>;
    const method = Array.isArray(route.method) ? route.method[0] : route.method;
    if (method === 'HEAD' || method === 'OPTIONS') return;

    const tag = matchTag(route.url);
    const tags = Array.isArray(existing.tags)
      ? (existing.tags as string[])
      : tag
        ? [tag]
        : undefined;

    const summary =
      typeof existing.summary === 'string'
        ? existing.summary
        : deriveSummary(String(method ?? 'GET'), route.url);

    const description =
      typeof existing.description === 'string'
        ? existing.description
        : `${String(method ?? 'GET').toUpperCase()} ${route.url}`;

    route.schema = {
      ...existing,
      ...(tags ? { tags } : {}),
      summary,
      description,
    };
  });

  await app.register(ScalarApiReference, {
    routePrefix: '/docs',
    configuration: {
      metaData: { title: 'Carbon API — reference' },
      theme: 'default',
      hideModels: false,
    },
  });

  // Vanilla `/openapi.json` for tooling that expects the standard path.
  app.get('/openapi.json', async () => app.swagger());
}
