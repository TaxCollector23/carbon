import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from './api-key.js';

/**
 * Structured access logging.
 *
 * Fastify's built-in request logging is disabled (`disableRequestLogging`)
 * because its shape is noisy and it emits two lines per request. This emits
 * exactly one line per completed request, at a level chosen by status class:
 *
 *   5xx → error, 4xx → warn, everything else → info
 *
 * so an operator can alert on `level>=50` without a parsing rule. Probe
 * traffic (`/health`, `/ready`, `/metrics`) is excluded by default — at a 1s
 * probe interval it would be 86k lines a day that say nothing.
 */
export interface AccessLogOptions {
  /** Paths excluded from logging. Defaults to the probe endpoints. */
  readonly ignorePaths?: Iterable<string>;
  /** Log slow requests at `warn` even when they succeed. Default 2000ms. */
  readonly slowRequestMs?: number;
}

const DEFAULT_IGNORED = ['/health', '/ready', '/metrics'];

/**
 * Value-shape patterns that must never appear in a log line, regardless of
 * which field surfaced them. Names are chosen to match the raw form of a
 * secret so a mistakenly-serialized env or header still gets scrubbed.
 *
 * Pino's `redact.paths` covers well-known field names (`authorization`,
 * `password`, …) but not the case where a secret is embedded in an opaque
 * blob — a request body, a URL, an error message. This is the belt to Pino's
 * suspenders.
 */
export const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  // Carbon API keys (prefix + secret).
  /ck_live_[a-f0-9]{6,}(?:\.[A-Za-z0-9_-]{6,})?/gi,
  // Stripe live/test secret keys.
  /sk_(?:live|test)_[A-Za-z0-9]{16,}/gi,
  // OpenAI/Anthropic-style bearer tokens.
  /sk-[A-Za-z0-9_-]{16,}/g,
  // Slack tokens.
  /xox[abpsr]-[A-Za-z0-9-]{10,}/g,
  // GitHub personal access + fine-grained tokens.
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  // AWS access key ids. We deliberately do NOT try to shape-match secret
  // access keys — the 40-char base64 pattern collides with too many
  // legitimate opaque ids in request bodies (S3 keys, IR hashes).
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  // Private key PEM headers — enough context that a false positive is
  // effectively impossible.
  /-----BEGIN (?:RSA |EC |DSA |PGP |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END/gi,
  // Postgres/Redis URIs with inline credentials (`user:pw@host`).
  /\b(?:postgres|postgresql|redis|rediss|mysql|mongodb):\/\/[^\s"'`]+:[^\s"'`@]+@[^\s"'`]+/gi,
];

/**
 * Field names whose *entire* value we redact regardless of shape. Extends
 * Pino's default so an env-carrying record slipped into the log context also
 * gets scrubbed.
 */
export const SECRET_FIELD_NAMES: ReadonlySet<string> = new Set(
  [
    'firebase_private_key',
    'firebaseprivatekey',
    'carbon_ai_api_key',
    'carbonaiapikey',
    's3_secret_key',
    's3secretkey',
    'database_url',
    'databaseurl',
    'stripe_secret_key',
    'stripesecretkey',
  ].map((s) => s.toLowerCase()),
);

const REDACTED = '[redacted]';

/**
 * Deep-scrub a log field payload: any string value gets each secret pattern
 * replaced with `[redacted]`; any keyed value whose key matches a known
 * secret env name is replaced whole. Non-mutating — returns a fresh object.
 * Called on every access-log line so accidental leakage stays out of stdout.
 */
export function scrubSecrets(value: unknown, depth = 0): unknown {
  if (depth > 6) return value;
  if (typeof value === 'string') {
    let out = value;
    for (const pat of SECRET_VALUE_PATTERNS) {
      // Fresh copy per iteration — some patterns are /g and stateful.
      const p = new RegExp(pat.source, pat.flags);
      out = out.replace(p, REDACTED);
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => scrubSecrets(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_FIELD_NAMES.has(k.toLowerCase())) {
        out[k] = REDACTED;
      } else {
        out[k] = scrubSecrets(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

const START_KEY = Symbol('carbon.accessLogStart');
const JOB_ID_KEY = Symbol('carbon.accessLogJobId');

interface TimedRequest extends FastifyRequest {
  [START_KEY]?: bigint;
  [JOB_ID_KEY]?: string;
}

/**
 * Job ids are short, opaque, and safe to log. Pattern is deliberately narrow
 * (base64url-ish + hyphens) so a stray field on some other route can't inject
 * unbounded strings into log output.
 */
const JOB_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

function extractJobId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = (payload as { jobId?: unknown }).jobId;
  if (typeof value !== 'string' || !JOB_ID_PATTERN.test(value)) return undefined;
  return value;
}

export async function registerAccessLog(
  app: FastifyInstance,
  ctx: AppContext,
  opts: AccessLogOptions = {},
): Promise<void> {
  const ignored = new Set(opts.ignorePaths ?? DEFAULT_IGNORED);
  const slowMs = opts.slowRequestMs ?? 2000;

  app.addHook('onRequest', async (req) => {
    (req as TimedRequest)[START_KEY] = process.hrtime.bigint();
  });

  // Capture the jobId from either the response body (async ingest returns
  // `{jobId}` with a 202) or the route param (GET /v1/jobs/:id). `preSerialization`
  // runs before Fastify turns the payload into JSON, so we get the object.
  app.addHook('preSerialization', async (req, _reply, payload) => {
    const routeParamId = (req.params as { id?: string } | undefined)?.id;
    const routeUrl = req.routeOptions?.url;
    if (routeUrl === '/v1/jobs/:id' && typeof routeParamId === 'string') {
      if (JOB_ID_PATTERN.test(routeParamId)) {
        (req as TimedRequest)[JOB_ID_KEY] = routeParamId;
      }
      return payload;
    }
    const bodyId = extractJobId(payload);
    if (bodyId) (req as TimedRequest)[JOB_ID_KEY] = bodyId;
    return payload;
  });

  app.addHook('onResponse', async (req, reply) => {
    if (ignored.has(pathname(req.url))) return;
    const status = reply.statusCode;
    const durationMs = elapsedMs(req);
    const fields = {
      method: req.method,
      // The matched route pattern, not the concrete URL — `/v1/projects/:id`
      // rather than `/v1/projects/prj_abc`. Keeps IDs out of the log index
      // while staying groupable.
      route: req.routeOptions?.url ?? 'unmatched',
      url: pathname(req.url),
      status,
      durationMs: Number(durationMs.toFixed(2)),
      reqId: String(req.id),
      ip: req.ip,
      key: (req as AuthenticatedRequest).apiKey?.prefix,
      jobId: (req as TimedRequest)[JOB_ID_KEY],
    };

    const safe = scrubSecrets(fields) as Record<string, unknown>;
    if (status >= 500) ctx.logger.error('api.access', safe);
    else if (status >= 400 || durationMs >= slowMs) ctx.logger.warn('api.access', safe);
    else ctx.logger.info('api.access', safe);
  });

  // A client that hangs up mid-request never reaches `onResponse`, so without
  // this the slowest requests in the system are the ones that never get
  // logged — exactly the ones worth seeing.
  app.addHook('onRequestAbort', async (req) => {
    if (ignored.has(pathname(req.url))) return;
    const fields = {
      method: req.method,
      route: req.routeOptions?.url ?? 'unmatched',
      url: pathname(req.url),
      durationMs: Number(elapsedMs(req).toFixed(2)),
      reqId: String(req.id),
    };
    ctx.logger.warn('api.access_aborted', scrubSecrets(fields) as Record<string, unknown>);
  });
}

function elapsedMs(req: FastifyRequest): number {
  const start = (req as TimedRequest)[START_KEY];
  if (start === undefined) return 0;
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function pathname(url: string): string {
  return url.split('?')[0] ?? url;
}
