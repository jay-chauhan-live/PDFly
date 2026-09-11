import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProblemError } from '../common/errors/problem.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env.schema.js';

/** Marks a key as claimed while its render is still running. */
const IN_PROGRESS = 'pending';

/** How long a claim survives if the process handling it dies mid-render. */
const CLAIM_TIMEOUT_SECONDS = 120;

export type IdempotencyClaim =
  | { outcome: 'claimed' }
  | { outcome: 'replay'; documentId: string }
  | { outcome: 'in_progress' };

/**
 * `Idempotency-Key` on render calls (PLAN §6, §8).
 *
 * A client that retries after a timeout has no way of knowing whether the
 * first attempt landed. Without this, the safe thing for them to do (retry)
 * is the expensive thing for us: a second render, a second stored object, and
 * a second entry on the bill.
 *
 * Keys are namespaced per organization, so one tenant's choice of key cannot
 * collide with — or reveal — another's.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly ttlSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.ttlSeconds = config.get('IDEMPOTENCY_TTL_SECONDS', { infer: true });
  }

  private key(orgId: string, key: string): string {
    return `idem:${orgId}:${key}`;
  }

  /**
   * Claims a key, or reports what the previous holder did with it.
   *
   * SET NX is what makes this safe under concurrency: two simultaneous
   * retries race for the claim and exactly one wins, so the other waits
   * rather than rendering the same document again.
   */
  async claim(orgId: string, key: string): Promise<IdempotencyClaim> {
    const claimed = await this.redis.set(
      this.key(orgId, key),
      IN_PROGRESS,
      'EX',
      CLAIM_TIMEOUT_SECONDS,
      'NX',
    );

    if (claimed === 'OK') return { outcome: 'claimed' };

    const existing = await this.redis.get(this.key(orgId, key));

    // Expired between the SET and the GET: let the caller through rather than
    // refusing a request that nothing is actually working on.
    if (existing === null) return { outcome: 'claimed' };
    if (existing === IN_PROGRESS) return { outcome: 'in_progress' };

    return { outcome: 'replay', documentId: existing };
  }

  /** Records the result, extending the claim to its full retention window. */
  async fulfil(orgId: string, key: string, documentId: string): Promise<void> {
    await this.redis.set(this.key(orgId, key), documentId, 'EX', this.ttlSeconds);
  }

  /**
   * Releases a claim whose render failed, so a retry is allowed to try again.
   * A failed render is not a result worth replaying.
   */
  async release(orgId: string, key: string): Promise<void> {
    try {
      await this.redis.del(this.key(orgId, key));
    } catch (error) {
      // The claim expires on its own; losing this is not worth failing on.
      this.logger.warn({ err: error }, `could not release idempotency key for org ${orgId}`);
    }
  }

  static conflict(): ProblemError {
    return new ProblemError(
      'idempotency_conflict',
      409,
      'A request with this Idempotency-Key is still being processed',
      { retryAfter: 2 },
    );
  }
}
