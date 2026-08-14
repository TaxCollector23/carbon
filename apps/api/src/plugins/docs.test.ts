import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { API_TAGS, matchTag, registerDocs } from './docs.js';
import { registerProjectRoutes } from '../routes/projects.js';
import { registerSnapshotRoutes } from '../routes/snapshots.js';
import { registerEventRoutes } from '../routes/events.js';
import { registerOrganizationRoutes } from '../routes/organizations.js';
import { registerArtifactRoutes } from '../routes/artifacts.js';
import { registerAssertionRoutes } from '../routes/assertions.js';
import { registerAiQualityRoutes } from '../routes/ai-quality.js';
import { registerChaosPresetRoutes } from '../routes/chaos-presets.js';
import { registerContractRoutes } from '../routes/contract.js';
import { registerEmulatorRoutes } from '../routes/emulators.js';
import { registerGraphRoutes } from '../routes/graphs.js';
import { registerIngestRoutes } from '../routes/ingest.js';
import { registerJobRoutes } from '../routes/jobs.js';
import { registerScimRoutes } from '../routes/scim.js';
import { registerSsoRoutes } from '../routes/sso.js';
import { registerUsageRoutes } from '../routes/usage.js';
import type { AppContext } from '../context.js';

/**
 * The docs plugin is registered *before* routes, and its `onRoute` hook is
 * what actually tags each subsequently added handler. These tests boot a
 * fresh Fastify instance, register the plugin, then register one route per
 * top-level tag using a URL that must match the plugin's prefix map. If any
 * mapping regresses, one of the `toContain('<Tag>')` assertions fires.
 */

interface StubRoute {
  method: 'GET' | 'POST';
  url: string;
  tag: string;
}

/**
 * Minimal set of routes — one per API tag — that mirrors the real prefixes
 * registered by server.ts. Kept alongside the tag list so a new tag added
 * to `API_TAGS` immediately surfaces here as a missing fixture.
 */
const FIXTURE_ROUTES: readonly StubRoute[] = [
  { method: 'GET', url: '/v1/projects', tag: 'Projects' },
  { method: 'POST', url: '/v1/snapshots', tag: 'Snapshots' },
  { method: 'GET', url: '/v1/emulators', tag: 'Emulators' },
  { method: 'GET', url: '/v1/api-keys', tag: 'Api Keys' },
  { method: 'GET', url: '/v1/artifacts/abc', tag: 'Artifacts' },
  { method: 'GET', url: '/v1/events', tag: 'Events' },
  { method: 'GET', url: '/v1/organizations', tag: 'Organizations' },
  { method: 'POST', url: '/v1/billing/checkout', tag: 'Billing' },
  { method: 'GET', url: '/scim/v2/Users', tag: 'SCIM' },
  { method: 'GET', url: '/v1/chaos-presets', tag: 'Chaos Presets' },
  { method: 'GET', url: '/v1/contract/xyz', tag: 'Contract' },
  { method: 'GET', url: '/v1/assertions', tag: 'Assertions' },
  { method: 'GET', url: '/v1/graphs/xyz', tag: 'Graphs' },
  { method: 'POST', url: '/v1/cli-auth/start', tag: 'CLI Auth' },
  { method: 'GET', url: '/v1/me', tag: 'Me' },
  { method: 'GET', url: '/v1/health/live', tag: 'Health' },
  { method: 'GET', url: '/v1/ai-quality/latest', tag: 'AI Quality' },
  { method: 'GET', url: '/v1/usage', tag: 'Usage' },
  { method: 'GET', url: '/v1/sso/providers', tag: 'SSO' },
  { method: 'GET', url: '/v1/events/export', tag: 'Export' },
  { method: 'GET', url: '/v1/projects/pid/share-links', tag: 'Share Links' },
  { method: 'POST', url: '/v1/ingest', tag: 'Ingest' },
];

async function bootWithFixtures() {
  const app = Fastify({ logger: false });
  await registerDocs(app, 'test-1.2.3');
  for (const r of FIXTURE_ROUTES) {
    if (r.method === 'GET') {
      app.get(r.url, async () => ({ ok: true }));
    } else {
      app.post(r.url, async () => ({ ok: true }));
    }
  }
  await app.ready();
  return app;
}

describe('docs plugin', () => {
  it('serves /openapi.json as valid OpenAPI 3.1 JSON', async () => {
    const app = await bootWithFixtures();
    try {
      const res = await app.inject('/openapi.json');
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.openapi).toBe('3.1.0');
      expect(body.info.title).toBe('Carbon API');
      expect(body.info.version).toBe('test-1.2.3');
      expect(body.info.contact?.email).toContain('@');
      expect(body.info.license?.name).toBe('Apache-2.0');
      expect(Array.isArray(body.servers)).toBe(true);
      expect(body.servers).toEqual(
        expect.arrayContaining([expect.objectContaining({ url: 'http://localhost:4000' })]),
      );
      expect(body.components.securitySchemes.apiKey).toBeTruthy();
      expect(body.components.securitySchemes.bearerAuth).toBeTruthy();
      expect(body.components.securitySchemes.sessionCookie).toBeTruthy();
      expect(body.security).toEqual(
        expect.arrayContaining([{ apiKey: [] }, { bearerAuth: [] }, { sessionCookie: [] }]),
      );
    } finally {
      await app.close();
    }
  });

  it('lists every module tag in the top-level tags array', async () => {
    const app = await bootWithFixtures();
    try {
      const body = app.swagger();
      const names = (body.tags ?? []).map((t: { name: string }) => t.name);
      for (const t of API_TAGS) {
        expect(names).toContain(t.name);
      }
    } finally {
      await app.close();
    }
  });

  it('auto-tags each registered route with its module tag', async () => {
    const app = await bootWithFixtures();
    try {
      const body = app.swagger() as {
        paths: Record<string, Record<string, { tags?: string[]; summary?: string }>>;
      };

      for (const r of FIXTURE_ROUTES) {
        // Fastify turns `:id` into `{id}` when materializing the spec.
        const openapiPath = r.url.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
        const path = body.paths[openapiPath];
        expect(path, `missing path ${openapiPath}`).toBeTruthy();
        const op = path?.[r.method.toLowerCase()];
        expect(op, `missing ${r.method} ${openapiPath}`).toBeTruthy();
        expect(op?.tags).toContain(r.tag);
        expect(op?.summary).toBeTruthy();
      }
    } finally {
      await app.close();
    }
  });

  it('publishes response.200 JSON schemas for hot routes', async () => {
    const app = Fastify({ logger: false });
    await registerDocs(app, 'test-1.2.3');
    // A no-op AppContext is enough — we only need the route registration side
    // effect (schema attached to the route object), not any handler execution.
    const ctx = {
      db: {} as unknown,
      storage: {} as unknown,
    } as unknown as AppContext;
    await registerProjectRoutes(app, ctx);
    await registerSnapshotRoutes(app, ctx);
    await registerEventRoutes(app, ctx);
    await registerOrganizationRoutes(app, ctx);
    await app.ready();
    try {
      const body = app.swagger() as {
        paths: Record<
          string,
          Record<
            string,
            {
              responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
            }
          >
        >;
      };

      const cases: Array<[string, string, string]> = [
        ['/v1/projects', 'get', '200'],
        ['/v1/projects', 'post', '201'],
        ['/v1/projects/{slug}/snapshots', 'get', '200'],
        ['/v1/snapshots', 'post', '201'],
        ['/v1/events', 'get', '200'],
        ['/v1/organizations', 'get', '200'],
        ['/v1/organizations/{id}/members', 'get', '200'],
      ];
      for (const [path, method, status] of cases) {
        const op = body.paths[path]?.[method];
        expect(op, `missing operation ${method.toUpperCase()} ${path}`).toBeTruthy();
        const responseSchema = op?.responses?.[status]?.content?.['application/json']?.schema;
        expect(
          responseSchema,
          `missing responses.${status}.content.application/json.schema for ${method.toUpperCase()} ${path}`,
        ).toBeTruthy();
      }
    } finally {
      await app.close();
    }
  });

  it('publishes response.200 schemas for every /v1/* GET route that returns JSON', async () => {
    const app = Fastify({ logger: false });
    await registerDocs(app, 'test-1.2.3');
    const ctx = {
      db: {} as unknown,
      storage: {
        list: () => (async function* () {})(),
        get: async () => null,
        head: async () => null,
      } as unknown,
      emulators: { list: () => [] } as unknown,
    } as unknown as AppContext;
    await registerProjectRoutes(app, ctx);
    await registerSnapshotRoutes(app, ctx);
    await registerEventRoutes(app, ctx);
    await registerOrganizationRoutes(app, ctx);
    await registerArtifactRoutes(app, ctx);
    await registerAssertionRoutes(app, ctx);
    await registerAiQualityRoutes(app, ctx);
    await registerChaosPresetRoutes(app, ctx);
    await registerContractRoutes(app, ctx);
    await registerEmulatorRoutes(app, ctx);
    await registerGraphRoutes(app, ctx);
    await registerIngestRoutes(app, ctx);
    await registerJobRoutes(app, ctx);
    await registerScimRoutes(app, ctx);
    await registerSsoRoutes(app, ctx);
    await registerUsageRoutes(app, ctx);
    await app.ready();
    try {
      const spec = app.swagger() as {
        paths: Record<
          string,
          Record<
            string,
            {
              responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
            }
          >
        >;
      };

      // Endpoints whose 200 body is deliberately not JSON (binary streams,
      // CSV, ZIP). Everything else must publish a JSON schema so codegen
      // tools have something to point at.
      const SKIP: readonly string[] = [
        '/v1/projects/{slug}/ir/{id}', // application/json but raw byte stream
        '/v1/projects/{slug}/graphs/{id}', // application/json but raw byte stream
        '/v1/projects/{slug}/snapshots/{name}', // raw serialized StateSnapshot JSON
        '/v1/snapshots/{slug}/diff', // dynamic StateDiff shape
        '/v1/events/export', // text/csv attachment
        '/v1/events/stream', // text/event-stream, long-lived SSE
      ];

      const missing: string[] = [];
      for (const [path, ops] of Object.entries(spec.paths ?? {})) {
        if (!path.startsWith('/v1/')) continue;
        const get = ops.get;
        if (!get) continue;
        if (SKIP.includes(path)) continue;
        const schema = get.responses?.['200']?.content?.['application/json']?.schema;
        if (!schema) missing.push(`GET ${path}`);
      }
      expect(missing, `missing response.200 schemas:\n${missing.join('\n')}`).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('publishes x-tagGroups covering every module tag', async () => {
    const app = await bootWithFixtures();
    try {
      const spec = app.swagger() as {
        'x-tagGroups'?: ReadonlyArray<{ name: string; tags: readonly string[] }>;
        tags?: ReadonlyArray<{ name: string }>;
      };
      const groups = spec['x-tagGroups'];
      expect(groups, 'x-tagGroups should be present in the served spec').toBeTruthy();
      expect(groups?.map((g) => g.name)).toEqual(['Core', 'Runtime', 'Enterprise', 'Ops', 'Auth']);
      // Every tag registered in API_TAGS must appear in exactly one group so
      // Scalar's sidebar cannot silently drop one.
      const grouped = new Set(groups?.flatMap((g) => g.tags) ?? []);
      for (const t of API_TAGS) {
        // Some tags (Ingest, Share Links, Export, Assertions, etc.) also appear
        // in the fixture map — just assert every tag is grouped somewhere.
        // (SCIM is grouped under Enterprise; Export under Enterprise; etc.)
        // A missing tag would fail the sidebar rendering.
        if (
          t.name === 'Ingest' ||
          t.name === 'Artifacts' ||
          t.name === 'Graphs' ||
          t.name === 'Assertions' ||
          t.name === 'Projects' ||
          t.name === 'Emulators' ||
          t.name === 'Snapshots' ||
          t.name === 'Chaos Presets' ||
          t.name === 'Contract' ||
          t.name === 'Share Links' ||
          t.name === 'Organizations' ||
          t.name === 'Billing' ||
          t.name === 'SSO' ||
          t.name === 'SCIM' ||
          t.name === 'Export' ||
          t.name === 'Events' ||
          t.name === 'Usage' ||
          t.name === 'AI Quality' ||
          t.name === 'Health' ||
          t.name === 'Api Keys' ||
          t.name === 'CLI Auth' ||
          t.name === 'Me'
        ) {
          expect(grouped, `tag "${t.name}" is not in any x-tagGroups section`).toContain(t.name);
        }
      }
    } finally {
      await app.close();
    }
  });

  it('surfaces response examples for the highest-value endpoints', async () => {
    const app = Fastify({ logger: false });
    await registerDocs(app, 'test-1.2.3');
    const ctx = {
      db: {} as unknown,
      storage: {
        list: () => (async function* () {})(),
        get: async () => null,
        head: async () => null,
      } as unknown,
      emulators: { list: () => [] } as unknown,
    } as unknown as AppContext;
    await registerProjectRoutes(app, ctx);
    await registerAiQualityRoutes(app, ctx);
    await registerUsageRoutes(app, ctx);
    await app.ready();
    try {
      const spec = app.swagger() as {
        paths: Record<
          string,
          Record<
            string,
            {
              responses?: Record<
                string,
                {
                  content?: Record<
                    string,
                    { example?: unknown; schema?: { examples?: unknown[] } }
                  >;
                }
              >;
            }
          >
        >;
      };

      const cases: Array<[string, string, string]> = [
        // Projects list — populated example with a `data` array of one project.
        ['/v1/projects', 'get', '200'],
        // AI quality latest — populated example with a report shape.
        ['/v1/projects/{id}/ai-quality/latest', 'get', '200'],
        // Usage aggregate — populated example with `totals`.
        ['/v1/usage', 'get', '200'],
      ];
      for (const [path, method, status] of cases) {
        const mediaType =
          spec.paths[path]?.[method]?.responses?.[status]?.content?.['application/json'];
        expect(mediaType, `missing media type for ${method.toUpperCase()} ${path}`).toBeTruthy();
        // Fastify Swagger lifts a JSON-Schema `examples` array into the OpenAPI
        // Media Type Object's `example` field. Accept either spelling so the
        // assertion holds regardless of which layer surfaced it.
        const example =
          (mediaType as { example?: unknown })?.example ??
          (mediaType?.schema as { examples?: unknown[] } | undefined)?.examples?.[0];
        expect(example, `missing example on ${method.toUpperCase()} ${path}`).toBeTruthy();
      }
    } finally {
      await app.close();
    }
  });

  it('matchTag returns the expected tag for representative paths', () => {
    expect(matchTag('/v1/projects')).toBe('Projects');
    expect(matchTag('/v1/projects/xyz/share-links')).toBe('Share Links');
    expect(matchTag('/v1/projects/xyz/snapshots')).toBe('Snapshots');
    expect(matchTag('/v1/events/export')).toBe('Export');
    expect(matchTag('/v1/events')).toBe('Events');
    expect(matchTag('/v1/health/live')).toBe('Health');
    expect(matchTag('/scim/v2/Users')).toBe('SCIM');
    expect(matchTag('/something/unknown')).toBeNull();
  });
});
