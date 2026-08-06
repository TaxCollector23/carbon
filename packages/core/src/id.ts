import { randomUUID, randomBytes } from 'node:crypto';

/**
 * Prefixed, sortable, base32 identifiers — similar in spirit to Stripe or Linear.
 * `prj_9f3ac2…`, `rec_a12bd7…`. Human-readable, greppable, safe in URLs.
 */
export function makeId(prefix: string, size = 12): string {
  const bytes = randomBytes(size);
  const encoded = base32(bytes);
  return `${prefix}_${encoded}`;
}

export function uuid(): string {
  return randomUUID();
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}
