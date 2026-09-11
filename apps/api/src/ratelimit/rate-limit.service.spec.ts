import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { RateLimitService } from './rate-limit.service.js';

/**
 * Against real Redis: the window is a Lua script, and the property that
 * matters — that concurrent requests cannot all slip under the limit — only
 * exists because the script is atomic.
 */
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
});

const limiter = new RateLimitService(redis);
const subject = () => `test:${randomUUID()}`;

afterAll(async () => {
  await redis.quit();
});

describe('RateLimitService', () => {
  it('admits up to the limit and refuses the next one', async () => {
    const key = subject();

    for (let i = 1; i <= 3; i += 1) {
      const verdict = await limiter.consume(key, 3);
      expect(verdict.allowed, `request ${i}`).toBe(true);
      expect(verdict.remaining).toBe(3 - i);
    }

    const refused = await limiter.consume(key, 3);

    expect(refused.allowed).toBe(false);
    expect(refused.remaining).toBe(0);
    expect(refused.retryAfter).toBeGreaterThan(0);
  });

  it('admits exactly the limit when requests arrive together', async () => {
    const key = subject();

    // The whole point of doing this in one script: a read-then-write limiter
    // would let all ten see a count of zero and admit all ten.
    const verdicts = await Promise.all(Array.from({ length: 10 }, () => limiter.consume(key, 4)));

    expect(verdicts.filter((v) => v.allowed)).toHaveLength(4);
    expect(verdicts.filter((v) => !v.allowed)).toHaveLength(6);
  });

  it('keeps separate subjects on separate budgets', async () => {
    const a = subject();
    const b = subject();

    await limiter.consume(a, 1);

    expect((await limiter.consume(a, 1)).allowed).toBe(false);
    expect((await limiter.consume(b, 1)).allowed).toBe(true);
  });

  it('slides: the window frees up as the oldest request ages out', async () => {
    const key = subject();

    expect((await limiter.consume(key, 1, 300)).allowed).toBe(true);
    expect((await limiter.consume(key, 1, 300)).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 350));

    expect((await limiter.consume(key, 1, 300)).allowed).toBe(true);
  });

  it('reports a reset time based on the oldest request, not the newest', async () => {
    const key = subject();
    const before = Math.ceil(Date.now() / 1000);

    const first = await limiter.consume(key, 2, 60_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await limiter.consume(key, 2, 60_000);

    // Both windows expire when the first request does, give or take a second.
    expect(second.resetAt).toBe(first.resetAt);
    expect(second.resetAt).toBeGreaterThanOrEqual(before + 59);
  });
});
