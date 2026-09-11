import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { CryptoService } from '../common/crypto.service.js';
import { SecretsVault } from './secrets.vault.js';
import type { ConfigService } from '@nestjs/config';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
});

const config = {
  get: () => Buffer.alloc(32, 9).toString('base64'),
} as unknown as ConfigService<never, true>;

const crypto = new CryptoService(config);
const vault = new SecretsVault(redis, crypto);

const PASSWORD = 'a-very-secret-open-password';

afterAll(async () => {
  await redis.quit();
});

describe('CryptoService', () => {
  it('round-trips a value', () => {
    expect(crypto.decrypt(crypto.encrypt(PASSWORD))).toBe(PASSWORD);
  });

  it('produces different ciphertext each time, so equal values are not linkable', () => {
    expect(crypto.encrypt(PASSWORD)).not.toBe(crypto.encrypt(PASSWORD));
  });

  it('refuses a ciphertext that has been tampered with', () => {
    const payload = crypto.encrypt(PASSWORD);
    const [iv, tag, body] = payload.split('.');

    // GCM authenticates: a flipped byte must fail, not decrypt to something else.
    const corrupted = `${iv}.${tag}.${Buffer.from(
      Buffer.from(body ?? '', 'base64url').map((b, i) => (i === 0 ? b ^ 0xff : b)),
    ).toString('base64url')}`;

    expect(() => crypto.decrypt(corrupted)).toThrow();
  });

  it('refuses a malformed payload rather than misreading it', () => {
    expect(() => crypto.decrypt('nonsense')).toThrow(/Malformed/);
    expect(() => crypto.decrypt('a.b.c')).toThrow(/Malformed/);
  });
});

describe('SecretsVault', () => {
  it('stores nothing and returns no reference when there is no protection', async () => {
    expect(await vault.store(undefined)).toBeNull();
    expect(await vault.take(null)).toBeNull();
  });

  it('returns an opaque reference, never the secret', async () => {
    const id = await vault.store({ userPassword: PASSWORD });

    expect(id).not.toBeNull();
    expect(id).not.toContain(PASSWORD);

    // And what lands in Redis is ciphertext, not the password.
    const stored = await redis.get(`secret:${id}`);
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(PASSWORD);
  });

  it('gives the protection block back to the job that holds the reference', async () => {
    const id = await vault.store({
      userPassword: PASSWORD,
      permissions: { print: false },
    });

    expect(await vault.take(id)).toEqual({
      userPassword: PASSWORD,
      permissions: { print: false },
    });
  });

  it('destroys the secret as it hands it over', async () => {
    const id = await vault.store({ userPassword: PASSWORD });

    await vault.take(id);

    // A replayed job must not get a second read of the password: it fails
    // loudly rather than quietly rendering without protection.
    expect(await vault.take(id)).toBeNull();
    expect(await redis.get(`secret:${id}`)).toBeNull();
  });

  it('expires on its own, so an abandoned job does not leave a password behind', async () => {
    const id = await vault.store({ userPassword: PASSWORD });

    const ttl = await redis.ttl(`secret:${id}`);

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(15 * 60);
  });

  it('discards a secret whose job was never queued', async () => {
    const id = await vault.store({ userPassword: PASSWORD });

    await vault.discard(id);

    expect(await redis.get(`secret:${id}`)).toBeNull();
  });
});
