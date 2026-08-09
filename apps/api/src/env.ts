import { z, ZodError } from 'zod';

const DEV_ALLOWED_ORIGINS = 'http://localhost:3001,http://localhost:1223';
const DEV_REDIS_URL = 'redis://127.0.0.1:6379';

const RawEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: databaseUrl(),
    DATABASE_PREPARE: optionalBoolean(),
    REDIS_URL: optionalRedisUrl(),
    STORAGE_ROOT: z.string().default('./.carbon-data'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'silent']).default('info'),
    CARBON_AI_PROVIDER: z
      .enum(['openrouter', 'openai', 'anthropic', 'gemini', 'local'])
      .default('openrouter'),
    CARBON_AI_API_KEY: z.string().optional(),
    CARBON_AI_MODEL: z.string().optional(),
    /**
     * Below this judge score, async ingest jobs land in `needs_review`
     * instead of `succeeded`. Sync ingest surfaces the verdict verbatim.
     */
    CARBON_AI_JUDGE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
    CARBON_AUTH_MODE: z.enum(['enforced', 'disabled']).default('disabled'),
    CARBON_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
    CARBON_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
    /**
     * When set, `/metrics` requires `Authorization: Bearer <token>`. Leave
     * unset only when the endpoint is unreachable from the internet — the
     * exposition includes route names and latency, which is reconnaissance.
     */
    CARBON_METRICS_TOKEN: optionalNonEmptyString(),
    /**
     * Number of trusted reverse-proxy hops in front of the API. Fastify uses
     * this to interpret `X-Forwarded-For` when computing `req.ip`. Default 0:
     * XFF is ignored entirely, so an anonymous caller cannot rotate the header
     * to reset their rate-limit bucket. In production, operators must set this
     * to the actual number of proxies (usually 1 or 2).
     */
    CARBON_TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    /**
     * Serve `/docs` and `/openapi.json` without an API key. Defaults to true
     * in dev/test so the reference is one URL away; defaults to false in
     * production so the spec is not a reconnaissance handout.
     */
    CARBON_PUBLIC_DOCS: optionalBoolean(),
    /**
     * Comma-separated allow-list of interfaces an emulator may bind to.
     * Restricted to loopback by default; add `0.0.0.0` explicitly if the
     * operator wants emulators reachable off-host.
     */
    CARBON_EMULATOR_ALLOWED_HOSTS: z.string().default('127.0.0.1,localhost'),
    /** Hard ceiling on a single request. Keep below the platform's own timeout. */
    CARBON_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(30_000),
    /**
     * How long to keep serving after SIGTERM before closing the listener, so
     * the load balancer sees `/ready` fail and stops routing first. Set to 0
     * on platforms that remove the instance from the pool before signalling.
     */
    CARBON_DRAIN_MS: z.coerce.number().int().min(0).max(120_000).default(5000),
    /** Max concurrently running emulators in this process. */
    CARBON_MAX_EMULATORS: z.coerce.number().int().min(1).max(500).default(25),
    /**
     * Uniform per-org emulator cap that overrides the per-plan defaults
     * (developer=1, team=10, enterprise=unlimited). Leave unset on hosted
     * so the plan tier decides; set explicitly on self-hosted.
     */
    CARBON_MAX_EMULATORS_PER_ORG: z.coerce.number().int().min(1).max(500).optional(),
    /**
     * When 1/true, every mutating request (POST/PATCH/DELETE) must carry an
     * `Idempotency-Key` header. Off by default so existing clients keep
     * working while the rollout is in flight.
     */
    CARBON_REQUIRE_IDEMPOTENCY: optionalBoolean(),
    /**
     * Comma-separated list of origins to allow CORS from. Use `*` for open
     * public API mode. Defaults to the dashboard origin in dev.
     */
    ALLOWED_ORIGINS: corsOrigins(),
    CARBON_RELEASE: z.string().default('dev'),
    /**
     * When true, the API process also runs BullMQ workers in-process. Enable
     * on single-service free deploys; disable once you scale workers out.
     */
    EMBED_WORKERS: z
      .string()
      .default('false')
      .transform((v) => v === 'true' || v === '1'),
    /**
     * Max concurrent ingestion jobs processed per worker. Applies both to a
     * standalone `apps/workers` process and to the in-process worker when
     * `EMBED_WORKERS=true`.
     */
    CARBON_INGEST_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
    /** `fs` (local disk) or `s3` (any S3-compatible endpoint incl. R2/B2/MinIO). */
    STORAGE_BACKEND: z.enum(['fs', 's3']).default('fs'),
    S3_ENDPOINT: optionalUrl(),
    S3_BUCKET: optionalNonEmptyString(),
    S3_REGION: z.string().default('auto'),
    S3_ACCESS_KEY: optionalNonEmptyString(),
    S3_SECRET_KEY: optionalNonEmptyString(),
    S3_PREFIX: optionalNonEmptyString(),
    /**
     * Hard per-query timeout on Postgres. A runaway query without this pins a
     * Node worker forever. Default 15s; range 1s–5min.
     */
    CARBON_DB_STATEMENT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(300_000)
      .default(15_000),
    /**
     * Stripe secret key. Setting this activates the billing routes; when
     * unset every /v1/billing/* endpoint returns 501 and `requireActivePlan`
     * is a no-op so dev / self-hosted deployments keep working.
     */
    STRIPE_SECRET_KEY: optionalNonEmptyString(),
    /** Signing secret for the /v1/billing/webhook endpoint. */
    STRIPE_WEBHOOK_SECRET: optionalNonEmptyString(),
    /** Price id for the Team plan; used when creating a Checkout session. */
    STRIPE_PRICE_TEAM: optionalNonEmptyString(),
    /**
     * OTLP HTTP endpoint for OpenTelemetry traces (e.g. `http://tempo:4318`,
     * `https://api.honeycomb.io`). When unset, tracing is fully disabled —
     * no OTel packages are loaded, no spans are exported, and boot stays fast.
     */
    OTEL_EXPORTER_OTLP_ENDPOINT: optionalNonEmptyString(),
    /** Service name reported on every span. */
    OTEL_SERVICE_NAME: z.string().default('carbon-api'),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_BACKEND === 's3') {
      for (const field of ['S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
        if (!env[field]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required when STORAGE_BACKEND=s3`,
          });
        }
      }
    }
  });

const EnvSchema = RawEnvSchema.transform((env) => ({
  ...env,
  // Historically we auto-defaulted REDIS_URL to redis://127.0.0.1:6379 in dev,
  // but ioredis retries commands forever when the URL points at a dead
  // socket — which turns "no Redis running" into hung idempotency + rate-limit
  // hooks for every non-public request. Now: only wire Redis when the caller
  // sets REDIS_URL explicitly. `pnpm dev` still works via `docker compose up`
  // (which sets REDIS_URL), and the auth-disabled bootless path degrades
  // gracefully because both plugins are gated on ctx.redis presence.
  REDIS_URL: env.REDIS_URL,
  CARBON_PUBLIC_DOCS: env.CARBON_PUBLIC_DOCS ?? env.NODE_ENV !== 'production',
  CARBON_EMULATOR_ALLOWED_HOSTS: parseAllowedHosts(env.CARBON_EMULATOR_ALLOWED_HOSTS),
}));

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const env = EnvSchema.parse(input);
  const problems = productionSafetyProblems(env);
  if (problems.length > 0) {
    throw new Error(`production safety check failed: ${problems.join('; ')}`);
  }
  if (env.NODE_ENV === 'production' && env.ALLOWED_ORIGINS === '*') {
    // Allowed, but noisy — the operator should have opted in explicitly.
    console.warn('carbon: ALLOWED_ORIGINS=* in production — every browser origin can call the API');
  }
  if (env.NODE_ENV === 'production' && env.CARBON_TRUSTED_PROXY_HOPS === 0) {
    // Not fatal: some deployments run the API on a raw socket. But most run
    // behind a proxy, and forgetting to set the hop count means `req.ip` will
    // silently be the proxy IP for every caller and rate limiting collapses.
    console.warn(
      'carbon: CARBON_TRUSTED_PROXY_HOPS=0 in production — set it to the number of reverse proxies in front of the API, or leave 0 if there are none',
    );
  }
  if (env.NODE_ENV === 'production' && env.CARBON_DB_STATEMENT_TIMEOUT_MS > 60_000) {
    console.warn(
      `carbon: CARBON_DB_STATEMENT_TIMEOUT_MS=${env.CARBON_DB_STATEMENT_TIMEOUT_MS} in production — a query holding a Node worker >60s is almost certainly a bug`,
    );
  }
  if (env.NODE_ENV === 'production' && env.CARBON_PUBLIC_DOCS) {
    console.warn(
      'carbon: CARBON_PUBLIC_DOCS=true in production — /docs and /openapi.json are reachable without an API key',
    );
  }
  return env;
}

export function loadEnv(): Env {
  try {
    return parseEnv();
  } catch (err) {
    // Fail loud at boot — misconfigured env is never a silent problem.
    if (err instanceof ZodError) {
      console.error('Invalid environment variables:', err.flatten().fieldErrors);
    } else {
      console.error('Invalid environment variables:', err instanceof Error ? err.message : err);
    }
    process.exit(1);
  }
}

/**
 * Production boot-time safety checks. Every one of these is a mistake that
 * should be caught before serving a single request, not after an incident.
 */
function productionSafetyProblems(env: Env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  if (env.CARBON_AUTH_MODE !== 'enforced') {
    problems.push('CARBON_AUTH_MODE must be "enforced" in production');
  }
  if (env.API_HOST === '127.0.0.1') {
    problems.push(
      'API_HOST cannot be 127.0.0.1 in production — the process will only accept local traffic',
    );
  }
  if (!env.REDIS_URL) {
    problems.push(
      'REDIS_URL is required in production for rate limiting, idempotency, and async jobs',
    );
  }
  if (env.ALLOWED_ORIGINS === DEV_ALLOWED_ORIGINS) {
    problems.push(
      'ALLOWED_ORIGINS must be set to deployed frontend origin(s), or "*" for intentional public CORS',
    );
  }
  if (env.API_HOST === 'localhost') {
    problems.push(
      'API_HOST cannot be localhost in production — it resolves to loopback, so no external traffic is accepted',
    );
  }
  return problems;
}

function optionalUrl(defaultValue?: string) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    defaultValue ? z.string().url().optional().default(defaultValue) : z.string().url().optional(),
  );
}

function optionalRedisUrl() {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().url().refine(isRedisUrl, 'REDIS_URL must use redis:// or rediss://').optional(),
  );
}

function isRedisUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'redis:' || protocol === 'rediss:';
  } catch {
    return false;
  }
}

function optionalBoolean() {
  return z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const normalized = value.trim().toLowerCase();
    if (normalized === '') return undefined;
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    return value;
  }, z.boolean().optional());
}

function databaseUrl() {
  return z
    .string()
    .url()
    .refine((value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === 'postgres:' || protocol === 'postgresql:';
      } catch {
        return false;
      }
    }, 'DATABASE_URL must use postgres:// or postgresql://');
}

function corsOrigins() {
  return z
    .string()
    .default(DEV_ALLOWED_ORIGINS)
    .refine(isAllowedOrigins, 'ALLOWED_ORIGINS must be "*" or comma-separated http(s) origins')
    .transform(normalizeAllowedOrigins);
}

function isAllowedOrigins(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed === '*') return true;
  return trimmed.split(',').every((origin) => isHttpOrigin(origin.trim()));
}

function isHttpOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

function normalizeAllowedOrigins(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '*') return '*';
  return trimmed
    .split(',')
    .map((origin) => new URL(origin.trim()).origin)
    .join(',');
}

function parseAllowedHosts(value: string): readonly string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function optionalNonEmptyString() {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(1).optional(),
  );
}
