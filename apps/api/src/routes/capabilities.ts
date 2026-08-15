import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { zodResponse } from '../plugins/schema-helpers.js';
import type { AppContext } from '../context.js';

const SPEC_FORMATS = [
  'openapi',
  'postman',
  'har',
  'graphql',
  'asyncapi',
  'protobuf',
  'grpc',
] as const;

const CapabilitiesResponse = z.object({
  service: z.literal('carbon-api'),
  apiVersion: z.literal('v1'),
  capabilities: z.object({
    specFormats: z.array(z.enum(SPEC_FORMATS)),
    statefulRuntime: z.boolean(),
    snapshots: z.boolean(),
    asyncIngest: z.boolean(),
    browserPlayground: z.boolean(),
  }),
  limits: z.object({
    ingestBodyBytes: z.number().int(),
    requestTimeoutMs: z.number().int(),
  }),
  links: z.object({
    docs: z.string(),
    samples: z.string(),
    tryIt: z.string(),
  }),
});

/**
 * Stable discovery contract for the CLI, SDKs, and integrations. Unlike
 * `/v1/version`, this is deliberately product-facing: clients can decide
 * whether a deployment supports a workflow without scraping documentation.
 */
export async function registerCapabilitiesRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  options: { requestTimeoutMs?: number } = {},
): Promise<void> {
  app.get(
    '/v1/capabilities',
    {
      schema: {
        summary: 'Discover server capabilities',
        description:
          'Return supported spec formats, runtime features, request limits, and stable links for client discovery. This endpoint is public.',
        response: { 200: zodResponse(CapabilitiesResponse) },
      },
    },
    async () => ({
      service: 'carbon-api' as const,
      apiVersion: 'v1' as const,
      capabilities: {
        specFormats: [...SPEC_FORMATS],
        statefulRuntime: true,
        snapshots: true,
        asyncIngest: Boolean(ctx.ingestionQueue || ctx.jobs),
        browserPlayground: true,
      },
      limits: {
        ingestBodyBytes: 32 * 1024 * 1024,
        requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      },
      links: {
        docs: '/docs',
        samples: '/v1/samples',
        tryIt: '/try',
      },
    }),
  );
}
