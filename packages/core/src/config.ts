import { z } from 'zod';
import { InvalidInputError } from './errors.js';

/**
 * Root Carbon configuration. Loaded from carbon.config.ts, environment
 * variables, or the SDK. Every field has a safe default so `carbon init`
 * produces a working project.
 */
export const CarbonConfigSchema = z.object({
  project: z.object({
    name: z.string().min(1),
    /** Slug used for cloud sync — must match [a-z0-9-]+ */
    slug: z.string().regex(/^[a-z0-9-]+$/),
  }),
  runtime: z.object({
    host: z.string().default('127.0.0.1'),
    port: z.number().int().min(1).max(65535).default(8787),
    persistence: z.enum(['memory', 'disk']).default('memory'),
    dataDir: z.string().default('.carbon/data'),
  }),
  logging: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'silent']).default('info'),
    pretty: z.boolean().default(true),
  }),
  ai: z
    .object({
      provider: z
        .enum(['openrouter', 'openai', 'anthropic', 'gemini', 'local'])
        .default('openrouter'),
      model: z.string().default('anthropic/claude-opus-5'),
      /** Env var name to read the API key from. Never inline a key here. */
      apiKeyEnv: z.string().default('CARBON_AI_API_KEY'),
    })
    .default({}),
  storage: z
    .object({
      backend: z.enum(['fs', 's3', 'memory']).default('fs'),
      root: z.string().default('.carbon'),
    })
    .default({}),
  experimental: z
    .object({
      graphql: z.boolean().default(false),
      webhookReplay: z.boolean().default(false),
    })
    .default({}),
  /**
   * Custom seed data — a map of resource id → rows. When present, the runtime
   * loads these rows into the state engine on `reset()` so the emulator starts
   * from a known baseline instead of an empty store.
   */
  fixtures: z.record(z.array(z.record(z.unknown()))).default({}),
});

export type CarbonConfig = z.infer<typeof CarbonConfigSchema>;
export type CarbonConfigInput = z.input<typeof CarbonConfigSchema>;

export function defineConfig(input: CarbonConfigInput): CarbonConfig {
  const result = CarbonConfigSchema.safeParse(input);
  if (!result.success) {
    throw new InvalidInputError('Invalid carbon.config.ts', {
      issues: result.error.issues,
    });
  }
  return result.data;
}
