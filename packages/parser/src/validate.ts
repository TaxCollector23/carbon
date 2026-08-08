/**
 * Contract testing primitives. `validateAgainstSpec` walks a JSON-Schema-shaped
 * spec (a subset — `type`, `properties`, `required`, `items`, `oneOf`,
 * `anyOf`) against an arbitrary response value. Intentionally naive: enough
 * to catch the common drift cases (missing field, wrong type, wrong shape)
 * without pulling in a full AJV runtime as a first pass.
 *
 * If a richer validator lands later (ajv, hyperjump), the return shape
 * (`{ ok, mismatches }`) is stable so callers keep working.
 */
export interface Mismatch {
  readonly path: string;
  readonly expected: string;
  readonly got: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly mismatches: readonly Mismatch[];
}

export type JsonSchemaLike =
  | {
      type?: 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'array' | 'object';
      properties?: Record<string, JsonSchemaLike>;
      required?: readonly string[];
      items?: JsonSchemaLike;
      oneOf?: readonly JsonSchemaLike[];
      anyOf?: readonly JsonSchemaLike[];
      nullable?: boolean;
    }
  | Record<string, unknown>;

/**
 * Validate a value against a spec. `spec` accepts either a JSON-Schema-style
 * object (with `type`, `properties`, `required`, `items`) or a full OpenAPI
 * MediaType.schema. Non-fatal by design — returns every mismatch it finds,
 * so a caller can render a report rather than stopping at the first miss.
 */
export function validateAgainstSpec(spec: JsonSchemaLike, response: unknown): ValidationResult {
  const mismatches: Mismatch[] = [];
  walk(spec as SchemaNode, response, '$', mismatches);
  return { ok: mismatches.length === 0, mismatches };
}

interface SchemaNode {
  type?: string;
  properties?: Record<string, SchemaNode>;
  required?: readonly string[];
  items?: SchemaNode;
  oneOf?: readonly SchemaNode[];
  anyOf?: readonly SchemaNode[];
  nullable?: boolean;
}

function walk(node: SchemaNode, value: unknown, path: string, out: Mismatch[]): void {
  if (!node || typeof node !== 'object') return;

  // oneOf/anyOf: succeed if any branch matches; otherwise report the union.
  const alternatives = node.oneOf ?? node.anyOf;
  if (alternatives && alternatives.length > 0) {
    for (const alt of alternatives) {
      const branch: Mismatch[] = [];
      walk(alt, value, path, branch);
      if (branch.length === 0) return;
    }
    out.push({
      path,
      expected: node.oneOf ? 'oneOf' : 'anyOf',
      got: typeOf(value),
    });
    return;
  }

  if (value === null) {
    if (node.nullable || node.type === 'null') return;
    if (!node.type) return; // untyped schema accepts anything, including null
    out.push({ path, expected: node.type, got: 'null' });
    return;
  }

  switch (node.type) {
    case 'string':
      if (typeof value !== 'string') out.push({ path, expected: 'string', got: typeOf(value) });
      return;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value))
        out.push({ path, expected: 'number', got: typeOf(value) });
      return;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value))
        out.push({ path, expected: 'integer', got: typeOf(value) });
      return;
    case 'boolean':
      if (typeof value !== 'boolean') out.push({ path, expected: 'boolean', got: typeOf(value) });
      return;
    case 'array': {
      if (!Array.isArray(value)) {
        out.push({ path, expected: 'array', got: typeOf(value) });
        return;
      }
      if (node.items) {
        for (let i = 0; i < value.length; i++) {
          walk(node.items, value[i], `${path}[${i}]`, out);
        }
      }
      return;
    }
    case 'object':
    case undefined: {
      if (node.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
        out.push({ path, expected: 'object', got: typeOf(value) });
        return;
      }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
      const obj = value as Record<string, unknown>;
      for (const key of node.required ?? []) {
        if (!(key in obj)) {
          out.push({ path: `${path}.${key}`, expected: 'required', got: 'missing' });
        }
      }
      if (node.properties) {
        for (const [key, propSchema] of Object.entries(node.properties)) {
          if (key in obj) walk(propSchema, obj[key], `${path}.${key}`, out);
        }
      }
      return;
    }
    default:
      return;
  }
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'number' && Number.isInteger(value)) return 'integer';
  return t;
}
