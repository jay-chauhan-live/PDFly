import { z } from 'zod';

/**
 * Environment contract for the api service.
 *
 * Validated once at boot: a misconfigured deployment should fail to start,
 * not fail on the first request that happens to touch the missing value.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  API_URL: z.url().default('http://localhost:3001'),
  WEB_URL: z.url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // Phase 1 renderer wiring.
  RENDERER_URL: z.url().default('http://localhost:3002'),
  // PLAN §6: 5 MB of markup is already generous.
  MAX_HTML_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(5 * 1024 * 1024),
  // PLAN §10: retention drives the nightly cleanup job added in Phase 7.
  RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  // Signed download URLs are short-lived; never a public bucket (PLAN §11).
  DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).default(900),
  /**
   * PLAN §6. Per credential for authenticated calls; the tighter budget is
   * per IP on the public auth routes, where the thing being rationed is
   * password guesses rather than renders.
   */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
  /** How long a retried render may reuse its original result (PLAN §6). */
  IDEMPOTENCY_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .default(24 * 60 * 60),

  /**
   * Async render workers in this process. 0 disables consumption entirely,
   * which is how you would run an api instance that only enqueues once the
   * worker moves to its own deployable (PLAN §2).
   */
  QUEUE_CONCURRENCY: z.coerce.number().int().min(0).default(2),
  /** HMAC key for outgoing webhook signatures (PLAN §6). */
  WEBHOOK_SIGNING_SECRET: z
    .string()
    .min(16, 'WEBHOOK_SIGNING_SECRET must be at least 16 characters'),
  /**
   * Webhooks to private addresses are an SSRF hole on the process holding the
   * database credentials (PLAN §11). Allowed in development, where the
   * receiver is usually localhost, and never by default anywhere else.
   */
  WEBHOOK_ALLOW_PRIVATE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  // PLAN §5: short-lived access token, long-lived rotating refresh token.
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  // Refresh tokens are opaque random values held in Redis, not JWTs, so
  // there is no second signing secret to configure.
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).default(30),

  /**
   * Fallback transport for organizations that have not configured SMTP yet
   * (PLAN §7). Without it a fresh signup cannot receive the email that would
   * let them sign in and configure one.
   */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USERNAME: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  // AES-256-GCM key for smtp_configs.password_encrypted — 32 bytes, base64.
  ENCRYPTION_KEY: z
    .string()
    .min(1)
    .refine((v) => Buffer.from(v, 'base64').length === 32, {
      message: 'ENCRYPTION_KEY must be 32 bytes encoded as base64',
    }),
});

export type Env = z.infer<typeof envSchema>;

/**
 * `validate` hook for @nestjs/config. Throws with every problem listed at
 * once, rather than one per restart.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }

  return result.data;
}
