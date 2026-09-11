import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { IdempotencyService } from './idempotency.service.js';
import type { ConfigService } from '@nestjs/config';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
});

const config = { get: () => 86_400 } as unknown as ConfigService<never, true>;
const service = new IdempotencyService(redis, config);

const ORG = 'org-a';
const OTHER_ORG = 'org-b';
const key = () => `key-${randomUUID()}`;

afterAll(async () => {
  await redis.quit();
});

describe('IdempotencyService', () => {
  it('lets the first caller through', async () => {
    expect(await service.claim(ORG, key())).toEqual({ outcome: 'claimed' });
  });

  it('refuses a second caller while the first is still rendering', async () => {
    const k = key();
    await service.claim(ORG, k);

    expect(await service.claim(ORG, k)).toEqual({ outcome: 'in_progress' });
  });

  it('replays the original document once the first render finished', async () => {
    const k = key();
    await service.claim(ORG, k);
    await service.fulfil(ORG, k, 'document-1');

    expect(await service.claim(ORG, k)).toEqual({ outcome: 'replay', documentId: 'document-1' });
  });

  it('grants the claim to exactly one of several simultaneous retries', async () => {
    const k = key();

    const claims = await Promise.all(Array.from({ length: 8 }, () => service.claim(ORG, k)));

    // SET NX is what makes this true: the other seven must wait rather than
    // each render the same document again.
    expect(claims.filter((c) => c.outcome === 'claimed')).toHaveLength(1);
    expect(claims.filter((c) => c.outcome === 'in_progress')).toHaveLength(7);
  });

  it('lets a retry through after a failed render released the key', async () => {
    const k = key();
    await service.claim(ORG, k);
    await service.release(ORG, k);

    // A failure is not a result worth replaying.
    expect(await service.claim(ORG, k)).toEqual({ outcome: 'claimed' });
  });

  it('namespaces keys per organization', async () => {
    const k = key();
    await service.claim(ORG, k);
    await service.fulfil(ORG, k, 'document-1');

    // The same key chosen by another tenant is a different key, and must not
    // reveal that ours exists.
    expect(await service.claim(OTHER_ORG, k)).toEqual({ outcome: 'claimed' });
  });
});
