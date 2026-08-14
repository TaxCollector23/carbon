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

/**
 * Same as {@link zodResponse}, but attach an `example` value to the resulting
 * JSON Schema fragment. Scalar and other OpenAPI viewers surface this in the
 * "Response Samples" pane so the docs page ships with plausible payloads
 * instead of every field being auto-generated from types. The example is not
 * runtime-validated against the schema — a bad example only mis-illustrates
 * the response.
 */
export function zodResponseWithExample<T>(schema: ZodTypeAny, example: T): Record<string, unknown> {
  // `examples` (array, JSON Schema draft-06+) instead of OpenAPI's singular
  // `example` — Fastify's Ajv runs in strict mode and rejects unknown
  // keywords, so `example` at the schema level would blow up route
  // registration. `examples` is a real JSON Schema keyword (Ajv treats it as
  // a no-op) and OpenAPI 3.1 recognizes it on Schema Objects. Scalar reads
  // either spelling.
  return { ...zodToOpenApi(schema), examples: [example] };
}

/**
 * Same as {@link zodBody}, but attach an `example` to the request body's JSON
 * Schema. Scalar's "Try it" panel pre-fills the editor with this value so a
 * reader can hit the endpoint without hand-typing a payload.
 */
export function zodBodyWithExample<T>(schema: ZodTypeAny, example: T): Record<string, unknown> {
  // `examples` (array, JSON Schema draft-06+) instead of OpenAPI's singular
  // `example` — Fastify's Ajv runs in strict mode and rejects unknown
  // keywords, so `example` at the schema level would blow up route
  // registration. `examples` is a real JSON Schema keyword (Ajv treats it as
  // a no-op) and OpenAPI 3.1 recognizes it on Schema Objects. Scalar reads
  // either spelling.
  return { ...zodToOpenApi(schema), examples: [example] };
}
