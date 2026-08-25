/**
 * drift.ts — tolerant comparison of a recorded API response against what the
 * live upstream returned, for drift detection.
 *
 * Replay's strict mode compares bodies as exact strings, which false-positives
 * the moment a real API returns a timestamp, an id, or a token that differs
 * from the recording. Drift mode compares *structurally* instead:
 *
 *   - types must match (a number that became a string is drift)
 *   - numbers compare numerically (1 vs 1.0 is not drift)
 *   - missing expected fields are drift (the API stopped returning a field)
 *   - extra fields in the live response are tolerated by default — an API
 *     adding a field is not a breaking change — unless `strictKeys` is set
 *   - arrays compare element-wise; length mismatch is drift
 *   - null and undefined are treated as equivalent (APIs flip between
 *     omitting a field and returning null routinely)
 *
 * Ignore paths let you exempt volatile fields, e.g.
 * `--ignore data.updated_at,data.items[*].token`. A `[*]` segment matches any
 * array index; a trailing `*` matches everything below.
 */

export interface DriftOptions {
  /** Dotted paths to exempt, e.g. `data.updated_at`, `items[*].token`. */
  readonly ignore?: readonly string[];
  /** Fail on fields the live response has that the recording lacks. */
  readonly strictKeys?: boolean;
}

export type DriftReason = 'type' | 'value' | 'missing' | 'extra' | 'length';

export type DriftResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** Dotted path of the mismatch, e.g. `data.items[2].price`. */
      readonly path: string;
      readonly reason: DriftReason;
      readonly expected: unknown;
      readonly actual: unknown;
    };

/** Treat null and undefined as equivalent — APIs flip between them freely. */
function equivalentNull(a: unknown, b: unknown): boolean {
  return (a === null || a === undefined) && (b === null || b === undefined);
}

/**
 * Compare `expected` (from the recording) against `actual` (from the live
 * upstream), walking both trees and reporting the first mismatch.
 */
export function compareDrift(expected: unknown, actual: unknown, opts: DriftOptions = {}): DriftResult {
  const ignore = (opts.ignore ?? []).map(parseIgnorePath);
  return walk(expected, actual, [], ignore, opts.strictKeys ?? false);
}

/** Split an ignore pattern into segments; `[*]` becomes a single segment. */
export function parseIgnorePath(pattern: string): string[] {
  return pattern
    .replace(/\[/g, '.')
    .replace(/\]/g, '')
    .split('.')
    .filter((seg) => seg.length > 0);
}

/**
 * True when an ignore pattern covers the current path. A pattern matches when
 * every pattern segment equals the path segment at that position, or the
 * pattern segment is `*` (matches that segment and everything below).
 */
function isIgnored(path: string[], patterns: string[][]): boolean {
  for (const pattern of patterns) {
    if (pattern.length > path.length) continue;
    let matched = true;
    for (let i = 0; i < pattern.length; i += 1) {
      if (pattern[i] !== '*' && pattern[i] !== path[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

function walk(
  expected: unknown,
  actual: unknown,
  path: string[],
  ignore: string[][],
  strictKeys: boolean,
): DriftResult {
  if (isIgnored(path, ignore)) return { ok: true };
  if (equivalentNull(expected, actual)) return { ok: true };

  const expectedType = typeof expected;
  const actualType = typeof actual;
  if (expectedType !== actualType) {
    return fail(path, 'type', expected, actual);
  }

  if (expected === null || actual === null) {
    // One side null and the other not — equivalentNull already handled both
    // null, so this is a real change.
    return fail(path, 'value', expected, actual);
  }

  if (expectedType === 'number') {
    return Number(expected) === Number(actual) ? { ok: true } : fail(path, 'value', expected, actual);
  }
  if (expectedType === 'string' || expectedType === 'boolean') {
    return expected === actual ? { ok: true } : fail(path, 'value', expected, actual);
  }

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return fail(path, 'type', expected, actual);
    }
    if (expected.length !== actual.length) {
      return fail(path, 'length', expected.length, actual.length);
    }
    for (let i = 0; i < expected.length; i += 1) {
      const sub = walk(expected[i], actual[i], [...path, `[${i}]`], ignore, strictKeys);
      if (!sub.ok) return sub;
    }
    return { ok: true };
  }

  if (expectedType === 'object') {
    const expectedRecord = expected as Record<string, unknown>;
    const actualRecord = actual as Record<string, unknown>;

    for (const key of Object.keys(expectedRecord)) {
      if (!(key in actualRecord)) {
        // Missing is only drift when the recording expected a real value — an
        // expected null/undefined field being omitted is equivalent.
        if (expectedRecord[key] === null || expectedRecord[key] === undefined) continue;
        if (isIgnored([...path, key], ignore)) continue;
        return fail([...path, key], 'missing', expectedRecord[key], undefined);
      }
      const sub = walk(expectedRecord[key], actualRecord[key], [...path, key], ignore, strictKeys);
      if (!sub.ok) return sub;
    }

    if (strictKeys) {
      for (const key of Object.keys(actualRecord)) {
        if (!(key in expectedRecord) && !isIgnored([...path, key], ignore)) {
          return fail([...path, key], 'extra', undefined, actualRecord[key]);
        }
      }
    }
    return { ok: true };
  }

  // BigInt, symbol, function — shouldn't appear in JSON bodies.
  return expected === actual ? { ok: true } : fail(path, 'value', expected, actual);
}

function fail(path: string[], reason: DriftReason, expected: unknown, actual: unknown): DriftResult {
  return { ok: false, path: pathToString(path), reason, expected, actual };
}

/** `['items','[0]','price']` → `items[0].price` — no dot before brackets. */
function pathToString(path: string[]): string {
  if (path.length === 0) return '(root)';
  let out = path[0]!;
  for (let i = 1; i < path.length; i += 1) {
    const seg = path[i]!;
    out += seg.startsWith('[') ? seg : `.${seg}`;
  }
  return out;
}

/** Human-readable one-liner for a mismatch, for the CLI report. */
export function formatDrift(result: Extract<DriftResult, { ok: false }>): string {
  switch (result.reason) {
    case 'type':
      return `${result.path}: type changed ${describe(result.expected)} → ${describe(result.actual)}`;
    case 'value':
      return `${result.path}: value changed ${describe(result.expected)} → ${describe(result.actual)}`;
    case 'missing':
      return `${result.path}: field no longer present (was ${describe(result.expected)})`;
    case 'extra':
      return `${result.path}: unexpected field ${describe(result.actual)} (strict mode)`;
    case 'length':
      return `${result.path}: array length ${describe(result.expected)} → ${describe(result.actual)}`;
  }
}

function describe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.length > 60 ? `${value.slice(0, 60)}…` : value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (typeof value === 'object') return 'object';
  return String(value);
}
