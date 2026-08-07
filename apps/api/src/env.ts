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
    CARBON_AUTH_MODE: z.enum(['enforced', 'disabled']).default('disabled'),
    CARBON_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
    CARBON_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
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
    /** `fs` (local disk) or `s3` (any S3-compatible endpoint incl. R2/B2/MinIO). */
    STORAGE_BACKEND: z.enum(['fs', 's3']).default('fs'),
    S3_ENDPOINT: optionalUrl(),
    S3_BUCKET: optionalNonEmptyString(),
    S3_REGION: z.string().default('auto'),
    S3_ACCESS_KEY: optionalNonEmptyString(),
    S3_SECRET_KEY: optionalNonEmptyString(),
    S3_PREFIX: optionalNonEmptyString(),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_BACKEND !== 's3') return;
    for (const field of ['S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
      if (!env[field]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required when STORAGE_BACKEND=s3`,
        });
      }
    }
  });

const EnvSchema = RawEnvSchema.transform((env) => ({
  ...env,
  REDIS_URL: env.REDIS_URL ?? (env.NODE_ENV === 'production' ? undefined : DEV_REDIS_URL),
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

function optionalNonEmptyString() {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(1).optional(),
  );
}
