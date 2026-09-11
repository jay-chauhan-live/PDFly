import { Inject, Injectable } from '@nestjs/common';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import type { Redis } from 'ioredis';

export interface RateLimitVerdict {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix seconds at which the window frees up. */
  resetAt: number;
  /** Seconds to wait, for `Retry-After`. Only meaningful when refused. */
  retryAfter: number;
}

/**
 * A sliding window over a sorted set (PLAN §6, §8).
 *
 * A fixed window would let a caller spend the whole allowance at 11:59:59 and
 * the whole of the next one at 12:00:00 — twice the limit across two seconds.
 * Keeping the timestamps means the window really does slide.
 *
 * One script so it is atomic: separate count-then-add calls would let
 * concurrent requests each see a count below the limit and all be admitted.
 *
 * KEYS[1] the subject's key
 * ARGV    nowMs, windowMs, limit, a unique member for this request
 */
const SLIDING_WINDOW = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)

local used = redis.call('ZCARD', KEYS[1])
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local resetAt = now + window
if oldest[2] then resetAt = tonumber(oldest[2]) + window end

if used >= limit then
  return { 0, used, resetAt }
end

redis.call('ZADD', KEYS[1], now, ARGV[4])
-- The key only needs to outlive its oldest entry.
redis.call('PEXPIRE', KEYS[1], window)

return { 1, used + 1, resetAt }
`;

declare module 'ioredis' {
  interface RedisCommander {
    slidingWindow(
      key: string,
      nowMs: string,
      windowMs: string,
      limit: string,
      member: string,
    ): Promise<[number, number, number]>;
  }
}

@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    this.redis.defineCommand('slidingWindow', { numberOfKeys: 1, lua: SLIDING_WINDOW });
  }

  async consume(subject: string, limit: number, windowMs = 60_000): Promise<RateLimitVerdict> {
    const now = Date.now();
    const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;

    const [allowed, used, resetAtMs] = await this.redis.slidingWindow(
      `ratelimit:${subject}`,
      String(now),
      String(windowMs),
      String(limit),
      member,
    );

    const resetAt = Math.ceil(resetAtMs / 1000);

    return {
      allowed: allowed === 1,
      limit,
      remaining: Math.max(0, limit - used),
      resetAt,
      retryAfter: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
    };
  }
}
