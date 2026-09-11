import type { Params } from 'nestjs-pino';
import type { Env } from '../config/env.schema.js';

/**
 * Anything listed here is replaced with `[Redacted]` before a log line is
 * serialised. PDF passwords and SMTP credentials must never reach a log sink
 * (docs/PLAN.md §3, §11) — this is the last line of defence, not the first.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.protection',
  'req.body.protection.userPassword',
  'req.body.protection.ownerPassword',
  'req.body.password',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.passwordEncrypted',
  '*.userPassword',
  '*.ownerPassword',
  '*.token',
  '*.tokenHash',
  '*.refreshToken',
];

export function buildLoggerOptions(env: Env): Params {
  const isDev = env.NODE_ENV === 'development';

  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
      autoLogging: {
        ignore: (req) => req.url === '/health' || req.url === '/health/live',
      },
      customProps: (req) => ({
        requestId: req.id,
      }),
      transport: isDev
        ? {
            target: 'pino-pretty',
            options: { singleLine: true, colorize: true, translateTime: 'HH:MM:ss.l' },
          }
        : undefined,
    },
  };
}
