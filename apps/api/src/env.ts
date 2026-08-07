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
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail loud at boot — misconfigured env is never a silent problem.
    console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}
