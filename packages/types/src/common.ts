import { z } from 'zod';

export const HttpMethodSchema = z.enum([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

export const AuthSchemeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('api-key'), in: z.enum(['header', 'query']), name: z.string() }),
  z.object({ kind: z.literal('bearer'), format: z.string().optional() }),
  z.object({
    kind: z.literal('basic'),
  }),
  z.object({
    kind: z.literal('oauth2'),
    flows: z.array(z.enum(['authorizationCode', 'clientCredentials', 'password', 'implicit'])),
  }),
]);
export type AuthScheme = z.infer<typeof AuthSchemeSchema>;

/**
 * Normalized JSON-schema-like type used inside the IR. We deliberately avoid
 * carrying the full OpenAPI schema — the IR should be minimal and format-agnostic.
 */
export type JsonType =
  | { kind: 'string'; format?: string; enum?: readonly string[] }
  | { kind: 'number' | 'integer'; format?: string }
  | { kind: 'boolean' }
  | { kind: 'null' }
  | { kind: 'array'; items: JsonType }
  | { kind: 'object'; properties: Record<string, JsonType>; required: readonly string[] }
  | { kind: 'ref'; ref: string }
  | { kind: 'union'; anyOf: readonly JsonType[] }
  | { kind: 'unknown' };
