import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema.js';

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://pdfly:pdfly@localhost:5432/pdfly',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'pdfly',
  S3_ACCESS_KEY_ID: 'pdfly',
  S3_SECRET_ACCESS_KEY: 'pdfly-dev-secret',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  WEBHOOK_SIGNING_SECRET: 'w'.repeat(32),
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('validateEnv', () => {
  it('accepts a complete configuration and applies defaults', () => {
    const env = validateEnv(valid);

    expect(env.API_PORT).toBe(3001);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.S3_REGION).toBe('us-east-1');
  });

  it('applies the Phase 1 rendering defaults', () => {
    const env = validateEnv(valid);

    expect(env.RENDERER_URL).toBe('http://localhost:3002');
    // PLAN §6: 5 MB of markup is already generous.
    expect(env.MAX_HTML_BYTES).toBe(5 * 1024 * 1024);
    expect(env.RETENTION_DAYS).toBe(7);
  });

  it('requires the access-token signing secret', () => {
    const { JWT_ACCESS_SECRET: _omitted, ...withoutSecret } = valid;

    expect(() => validateEnv(withoutSecret)).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('coerces numeric and boolean values that arrive as strings', () => {
    const env = validateEnv({ ...valid, API_PORT: '8080', S3_FORCE_PATH_STYLE: 'false' });

    expect(env.API_PORT).toBe(8080);
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    expect(() =>
      validateEnv({ ...valid, ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/ENCRYPTION_KEY must be 32 bytes/);
  });

  it('reports every problem at once rather than one per restart', () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: '', JWT_ACCESS_SECRET: 'short' })).toThrow(
      /DATABASE_URL[\s\S]*JWT_ACCESS_SECRET/,
    );
  });
});
