import { describe, expect, it } from 'vitest';
import { buildLoggerOptions } from './logger.options.js';
import type { Env } from '../config/env.schema.js';

const env = { NODE_ENV: 'production', LOG_LEVEL: 'info' } as Env;

describe('buildLoggerOptions', () => {
  it('redacts PDF passwords and credentials (PLAN §3, §11)', () => {
    const { pinoHttp } = buildLoggerOptions(env);
    const paths = (pinoHttp as { redact: { paths: string[] } }).redact.paths;

    for (const path of [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.protection.userPassword',
      'req.body.protection.ownerPassword',
      '*.passwordEncrypted',
      '*.tokenHash',
    ]) {
      expect(paths).toContain(path);
    }
  });

  it('does not pretty-print outside development', () => {
    const { pinoHttp } = buildLoggerOptions(env);
    expect((pinoHttp as { transport?: unknown }).transport).toBeUndefined();
  });

  it('skips access logs for health probes', () => {
    const { pinoHttp } = buildLoggerOptions(env);
    const { autoLogging } = pinoHttp as {
      autoLogging: { ignore: (req: { url: string }) => boolean };
    };

    expect(autoLogging.ignore({ url: '/health' })).toBe(true);
    expect(autoLogging.ignore({ url: '/v1/pdf' })).toBe(false);
  });
});
