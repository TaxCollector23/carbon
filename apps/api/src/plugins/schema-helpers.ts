import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Convert a Zod schema to a JSON Schema fragment Fastify/Swagger can consume.
 *
 * The route files describe their request/response wire shapes in Zod (the
 * same schemas the handlers already `parse` at runtime); running them through
 * `zodToJsonSchema` lets `/openapi.json` publish something client codegen
 * tools (openapi-generator, orval, etc.) can actually target without any of
 * the routes having to keep a hand-written JSON Schema in sync.
 *
 * We strip the wrapper `$schema` and `definitions` that `zodToJsonSchema`
 * emits by default so the fragment can be dropped inline into a Fastify
 * route's `schema.response.200` / `schema.body` / `schema.querystring`.
 */
export function zodToOpenApi(schema: ZodTypeAny): Record<string, unknown> {
  const json = zodToJsonSchema(schema, {
    // `openApi3` mode omits `$schema` and produces `type: 'string', nullable: true`
    // for nullable fields — the exact dialect @fastify/swagger already understands.
    target: 'openApi3',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  delete json.$schema;
  delete json.definitions;
  return json;
}

/** Alias for `zodToOpenApi` used at request-body sites for readability. */
export const zodBody = zodToOpenApi;
/** Alias for `zodToOpenApi` used at querystring sites for readability. */
export const zodQuery = zodToOpenApi;
/** Alias for `zodToOpenApi` used at response sites for readability. */
export const zodResponse = zodToOpenApi;
