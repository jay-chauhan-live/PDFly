import { z } from 'zod';

const schema = z.object({
  RENDERER_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  RENDERER_HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // PLAN §10: 2–4 Chromium instances per container.
  POOL_SIZE: z.coerce.number().int().min(1).max(8).default(2),
  // Recycle a browser after this many jobs, or when it crosses the RSS ceiling.
  POOL_MAX_JOBS_PER_BROWSER: z.coerce.number().int().min(1).default(50),
  POOL_MAX_RSS_BYTES: z.coerce
    .number()
    .int()
    .default(1.5 * 1024 * 1024 * 1024),

  // PLAN §10: hard per-job timeout, enforced here and not only in the api.
  RENDER_TIMEOUT_MS_DEFAULT: z.coerce.number().int().min(1000).default(20_000),
  RENDER_TIMEOUT_MS_MAX: z.coerce.number().int().min(1000).default(60_000),

  // How long a request waits for a free browser before giving up. The api
  // turns this into a 503 with Retry-After.
  POOL_ACQUIRE_TIMEOUT_MS: z.coerce.number().int().min(100).default(10_000),
});

export type RendererConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RendererConfig {
  const result = schema.safeParse(env);

  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid renderer configuration:\n${lines.join('\n')}`);
  }

  return result.data;
}
