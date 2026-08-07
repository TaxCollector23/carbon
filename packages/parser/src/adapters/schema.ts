import type { JsonType } from '@carbon/types';

export function jsonSchemaToJsonType(
  node: unknown,
  root: unknown = node,
  visited: Set<string> = new Set(),
): JsonType {
  const resolved = resolveLocalRef(node, root, visited);
  if (!isRecord(resolved)) return { kind: 'unknown' };

  const anyOf = arrayOfSchemas(resolved.anyOf) ?? arrayOfSchemas(resolved.oneOf);
  if (anyOf) {
    return {
      kind: 'union',
      anyOf: anyOf.map((schema) => jsonSchemaToJsonType(schema, root, visited)),
    };
  }

  const schemaType = typeof resolved.type === 'string' ? resolved.type : inferSchemaType(resolved);
  switch (schemaType) {
    case 'string':
      return {
        kind: 'string',
        format: typeof resolved.format === 'string' ? resolved.format : undefined,
        enum: stringEnum(resolved.enum),
      };
    case 'integer':
    case 'number':
      return {
        kind: schemaType,
        format: typeof resolved.format === 'string' ? resolved.format : undefined,
      };
    case 'boolean':
      return { kind: 'boolean' };
    case 'null':
      return { kind: 'null' };
    case 'array':
      return { kind: 'array', items: jsonSchemaToJsonType(resolved.items, root, visited) };
    case 'object': {
      const properties: Record<string, JsonType> = {};
      if (isRecord(resolved.properties)) {
        for (const [name, property] of Object.entries(resolved.properties)) {
          properties[name] = jsonSchemaToJsonType(property, root, visited);
        }
      }
      return {
        kind: 'object',
        properties,
        required: Array.isArray(resolved.required)
          ? resolved.required.filter((value): value is string => typeof value === 'string')
          : [],
      };
    }
    default:
      return { kind: 'unknown' };
  }
}

export function resolveLocalRef(
  node: unknown,
  root: unknown,
  visited: Set<string> = new Set(),
): unknown {
  if (!isRecord(node) || typeof node.$ref !== 'string') return node;
  const ref = node.$ref;
  if (!ref.startsWith('#/') || visited.has(ref)) return null;
  let cursor: unknown = root;
  for (const segment of ref.slice(2).split('/')) {
    if (!isRecord(cursor)) return null;
    cursor = cursor[decodePointerSegment(segment)];
  }
  return resolveLocalRef(cursor, root, new Set(visited).add(ref));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayOfSchemas(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function inferSchemaType(schema: Record<string, unknown>): string | undefined {
  if (isRecord(schema.properties)) return 'object';
  if (schema.items !== undefined) return 'array';
  if (Array.isArray(schema.enum) && schema.enum.every((value) => typeof value === 'string')) {
    return 'string';
  }
  return undefined;
}

function stringEnum(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((entry): entry is string => typeof entry === 'string');
  return values.length === value.length ? values : undefined;
}

function decodePointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}
