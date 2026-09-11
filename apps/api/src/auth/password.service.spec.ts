import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('produces an Argon2id hash, not argon2i or argon2d (PLAN §5)', async () => {
    const hash = await service.hash('correct-horse-battery');

    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('salts: the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([
      service.hash('same-password'),
      service.hash('same-password'),
    ]);

    expect(a).not.toBe(b);
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await service.hash('correct-horse-battery');

    expect(await service.verify(hash, 'correct-horse-battery')).toBe(true);
    expect(await service.verify(hash, 'correct-horse-batterx')).toBe(false);
  });

  it('treats a malformed stored hash as a wrong password, not an error', async () => {
    await expect(service.verify('not-a-hash', 'anything')).resolves.toBe(false);
  });
});
