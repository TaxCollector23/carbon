import type { FastifyInstance } from 'fastify';
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
 */
export async function registerDocs(app: FastifyInstance, release: string): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Carbon API',
        description: 'Control plane for Carbon — projects, ingestion, emulators, snapshots.',
        version: release,
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            in: 'header',
            name: 'x-carbon-key',
            description: 'A key minted via POST /v1/api-keys or the `bootstrap` script.',
          },
        },
      },
      security: [{ apiKey: [] }],
      tags: [
        { name: 'projects', description: 'Organize ingested APIs' },
        { name: 'ingest', description: 'Turn OpenAPI/HAR/etc into an IR + behavior graph' },
        { name: 'emulators', description: 'Run compiled APIs as HTTP servers' },
        { name: 'snapshots', description: 'Save and restore runtime state' },
        { name: 'api-keys', description: 'Manage authentication credentials' },
        { name: 'health', description: 'Liveness, readiness, version' },
      ],
    },
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
