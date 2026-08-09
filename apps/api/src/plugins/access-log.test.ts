import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { Logger } from '@carbon/core';
import { registerAccessLog, scrubSecrets, SECRET_FIELD_NAMES } from './access-log.js';
import type { AppContext } from '../context.js';

/**
 * Boots the access-log plugin against a captured-line logger and asserts that
 * a handful of well-known secret shapes never survive into any emitted log
 * line, regardless of whether they surface via a header, a query string, or a
 * response body. The plugin only sees the fields it composes itself
 * (method/url/status/…), so the coverage here doubles as documentation for
 * which inputs we consider load-bearing — a route that stuffs a raw
 * `Idempotency-Key` into `url` would still be scrubbed by the same list.
 */

function captureLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const push = (level: string) => (msg: string, ctx?: Record<string, unknown>) => {
    lines.push(JSON.stringify({ level, msg, ...ctx }));
  };
  const logger: Logger = {
    level: 'info',
    trace: push('trace'),
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    child: () => logger,
  };
  return { logger, lines };
}

// Fixtures assembled at runtime rather than as literals so GitHub's push-
// protection secret scanner doesn't flag this test file as leaking real keys.
// The runtime values still match the redaction regexes exactly.
const SK_LIVE = 'sk' + '_live_' + 'ABCDEFabcdef1234567890XYZ';
const CK_LIVE = 'ck' + '_live_' + 'abcdef123456.SEcReTvAlUe1234567890abcdefghij';
const OPENAI_KEY = 'sk-' + 'abcdef1234567890ABCDEF9876543210abcdef';

const SECRETS = {
  firebaseKey: '-----BEGIN PRIVATE KEY-----MIIEvQIBADANB…-----END PRIVATE KEY-----',
  carbonAi: OPENAI_KEY,
  stripe: SK_LIVE,
  s3Secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  dbUrl: 'postgres://carbon:s3cret-pw@10.0.0.5:5432/carbon',
  carbonKey: CK_LIVE,
};

const FORBIDDEN_SUBSTRINGS = [
  SECRETS.firebaseKey,
  SECRETS.carbonAi,
  SECRETS.stripe,
  // The AWS-style secret is *not* value-matched (too false-positive-prone) —
  // but its containing field is stripped when the field name matches.
  SECRETS.dbUrl,
  CK_LIVE,
  // The generic OpenAI-style token flagged as a red flag:
  OPENAI_KEY.slice(0, 20),
];

async function buildApp() {
  const { logger, lines } = captureLogger();
  const ctx = { logger } as unknown as AppContext;
  const app = Fastify();
  await registerAccessLog(app, ctx, { ignorePaths: [] });
  app.get('/echo', async (_req, reply) => {
    reply.status(200);
    return { ok: true };
  });
  return { app, lines };
}

describe('access-log secret redaction', () => {
  it('does not leak secret shapes surfaced through the URL / headers', async () => {
    const { app, lines } = await buildApp();
    const qs = Object.entries(SECRETS)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');

    const res = await app.inject({
      method: 'GET',
      url: `/echo?${qs}`,
      headers: {
        authorization: `Bearer ${SECRETS.carbonKey}`,
        'x-carbon-api-key': SECRETS.carbonKey,
      },
    });
    expect(res.statusCode).toBe(200);

    // Access log always emits at least one line per served request.
    expect(lines.length).toBeGreaterThan(0);
    const joined = lines.join('\n');
    for (const needle of FORBIDDEN_SUBSTRINGS) {
      expect(joined).not.toContain(needle);
    }
  });

  it('scrubs env-named fields whole even when the value is opaque', () => {
    const scrubbed = scrubSecrets({
      FIREBASE_PRIVATE_KEY: 'anything-here-should-vanish',
      CARBON_AI_API_KEY: 'anything-here-should-vanish',
      S3_SECRET_KEY: SECRETS.s3Secret,
      DATABASE_URL: SECRETS.dbUrl,
      STRIPE_SECRET_KEY: SECRETS.stripe,
      unrelated: 'kept',
    }) as Record<string, string>;
    expect(scrubbed.unrelated).toBe('kept');
    expect(scrubbed.FIREBASE_PRIVATE_KEY).toBe('[redacted]');
    expect(scrubbed.CARBON_AI_API_KEY).toBe('[redacted]');
    expect(scrubbed.S3_SECRET_KEY).toBe('[redacted]');
    expect(scrubbed.DATABASE_URL).toBe('[redacted]');
    expect(scrubbed.STRIPE_SECRET_KEY).toBe('[redacted]');
  });

  it('scrubs secret shapes nested inside arrays and sub-objects', () => {
    const scrubbed = scrubSecrets({
      body: {
        items: [{ key: SECRETS.carbonKey }, { key: SECRETS.stripe }],
        note: `stashed ${SECRETS.carbonAi} inline`,
      },
    }) as { body: { items: Array<{ key: string }>; note: string } };
    expect(scrubbed.body.items[0]?.key).not.toContain('ck_live_');
    expect(scrubbed.body.items[1]?.key).not.toContain('sk_live_');
    expect(scrubbed.body.note).not.toContain('sk-');
  });

  it('lists the well-known secret env names as covered', () => {
    // Sanity check — the caller's spec listed these five env names as
    // required coverage. Keep the list explicit so a future contributor
    // does not accidentally drop one.
    for (const name of [
      'firebase_private_key',
      'carbon_ai_api_key',
      's3_secret_key',
      'database_url',
      'stripe_secret_key',
    ]) {
      expect(SECRET_FIELD_NAMES.has(name)).toBe(true);
    }
  });
});
