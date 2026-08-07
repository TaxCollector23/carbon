import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://127.0.0.1:6379'),
  STORAGE_ROOT: z.string().default('./.carbon-data'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'silent']).default('info'),
  CARBON_AI_PROVIDER: z.enum(['openrouter', 'openai', 'anthropic', 'gemini', 'local']).default('openrouter'),
  CARBON_AI_API_KEY: z.string().optional(),
  CARBON_AI_MODEL: z.string().optional(),
  CARBON_AUTH_MODE: z.enum(['enforced', 'disabled']).default('disabled'),
  CARBON_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  CARBON_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  /**
   * Comma-separated list of origins to allow CORS from. Use `*` for open
   * public API mode. Defaults to the dashboard origin in dev.
   */
  ALLOWED_ORIGINS: z.string().default('http://localhost:3001,http://localhost:1223'),
  CARBON_RELEASE: z.string().default('dev'),
  /**
   * When true, the API process also runs BullMQ workers in-process. Enable
   * on single-service free deploys; disable once you scale workers out.
   */
  EMBED_WORKERS: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail loud at boot — misconfigured env is never a silent problem.
    console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  assertProductionSafety(parsed.data);
  return parsed.data;
}

/**
 * Production booth-time safety checks. Every one of these is a mistake that
 * should be caught before serving a single request, not after an incident.
 */
function assertProductionSafety(env: Env): void {
  if (env.NODE_ENV !== 'production') return;
  const problems: string[] = [];
  if (env.CARBON_AUTH_MODE !== 'enforced') {
    problems.push('CARBON_AUTH_MODE must be "enforced" in production');
  }
  if (env.API_HOST === '127.0.0.1') {
    problems.push('API_HOST cannot be 127.0.0.1 in production — the process will only accept local traffic');
  }
  if (env.ALLOWED_ORIGINS === '*') {
    // Allowed, but noisy — the operator should have opted in explicitly.
    console.warn('carbon: ALLOWED_ORIGINS=* in production — every browser origin can call the API');
  }
  if (problems.length > 0) {
    console.error('carbon: refusing to boot in production — fix the following:');
    for (const p of problems) console.error(`  · ${p}`);
    process.exit(1);
  }
}
