import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema.js';

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://inkwell:inkwell@localhost:5432/inkwell',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'inkwell',
  S3_ACCESS_KEY_ID: 'inkwell',
  S3_SECRET_ACCESS_KEY: 'inkwell-dev-secret',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('validateEnv', () => {
  it('accepts a complete configuration and applies defaults', () => {
    const env = validateEnv(valid);

    expect(env.API_PORT).toBe(3001);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.S3_REGION).toBe('us-east-1');
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
