/**
 * Shape-matching regexes for well-known secret formats. Kept in a leaf
 * package so both the API runtime scrubber (`apps/api/src/plugins/access-log`)
 * and the offline audit tool (`carbon audit-secrets`) share the same source
 * of truth. Adding a pattern here strengthens both.
 *
 * Design rules for anything added here:
 *   - Prefer patterns with an unambiguous prefix (`sk_live_`, `ck_live_`,
 *     `-----BEGIN`, `xox[abpsr]-`). Naked base64/hex shapes attract too many
 *     false positives to be useful in a hard-fail linter.
 *   - Keep patterns anchored on the *value* shape, not on a surrounding key
 *     name — the scrubber and the auditor both process raw text and can't
 *     rely on JSON keys being visible.
 */
export interface SecretPattern {
  /** Short label — surfaces in scanner output. */
  readonly kind: string;
  /** The regex. Global flag required for repeated .replace / .matchAll use. */
  readonly regex: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  { kind: 'carbon-key', regex: /ck_live_[a-f0-9]{6,}(?:\.[A-Za-z0-9_-]{6,})?/gi },
  { kind: 'stripe-secret', regex: /sk_(?:live|test)_[A-Za-z0-9]{16,}/gi },
  { kind: 'openai-anthropic', regex: /sk-[A-Za-z0-9_-]{16,}/g },
  { kind: 'slack-token', regex: /xox[abpsr]-[A-Za-z0-9-]{10,}/g },
  { kind: 'github-token', regex: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { kind: 'aws-access-key', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    kind: 'private-key-pem',
    regex: /-----BEGIN (?:RSA |EC |DSA |PGP |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END/gi,
  },
  {
    kind: 'db-url-with-password',
    regex:
      /\b(?:postgres|postgresql|redis|rediss|mysql|mongodb):\/\/[^\s"'`]+:[^\s"'`@]+@[^\s"'`]+/gi,
  },
];

/**
 * Regex-only view for consumers (like the access-log scrubber) that only need
 * the pattern list, not the labels. `readonly RegExp[]` matches the historical
 * `SECRET_VALUE_PATTERNS` shape exactly.
 */
export const SECRET_VALUE_PATTERNS: readonly RegExp[] = SECRET_PATTERNS.map((p) => p.regex);
