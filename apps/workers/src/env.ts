import { z } from 'zod';

const EnvSchema = z.object({
  REDIS_URL: z
    .string()
    .url()
    .refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === 'redis:' || protocol === 'rediss:';
    }, 'REDIS_URL must use redis:// or rediss://'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  STORAGE_ROOT: z.string().default('./.carbon-data'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'silent']).default('info'),
  STORAGE_BACKEND: z.enum(['fs', 's3']).default('fs'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_PREFIX: z.string().optional(),
  CARBON_INGEST_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  assertStorageConfig(parsed.data);
  return parsed.data;
}

function assertStorageConfig(env: Env): void {
  if (env.STORAGE_BACKEND !== 's3') return;
  const missing = [
    ['S3_BUCKET', env.S3_BUCKET],
    ['S3_ACCESS_KEY', env.S3_ACCESS_KEY],
    ['S3_SECRET_KEY', env.S3_SECRET_KEY],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    console.error(`STORAGE_BACKEND=s3 requires ${missing.join(', ')}`);
    process.exit(1);
  }
}
