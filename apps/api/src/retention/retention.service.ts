import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { StorageService } from '../storage/storage.service.js';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env.schema.js';

/** Bounded so one sweep cannot hold a connection or the event loop for long. */
const BATCH_SIZE = 200;
const MAX_BATCHES = 50;

/**
 * How long one instance holds the right to sweep. Longer than a sweep takes,
 * short enough that a crashed instance does not block tonight's run.
 */
const LOCK_SECONDS = 30 * 60;

export interface SweepResult {
  deleted: number;
  objectsRemoved: number;
  objectFailures: number;
}

/**
 * Deletes documents past their expiry, and the objects behind them (PLAN §10).
 *
 * Retention is a promise as much as a cost control: a customer who was told
 * their PDFs live for seven days should not find them still downloadable on
 * day thirty. The object goes first — if that fails the row survives and the
 * next sweep retries, whereas the reverse would orphan the object with
 * nothing left pointing at it.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async nightly(): Promise<void> {
    if (!this.config.get('RETENTION_SWEEP_ENABLED', { infer: true })) {
      this.logger.debug('retention sweep disabled');
      return;
    }

    // Every instance runs this cron; only one should do the work. A lock with
    // a TTL means a crash mid-sweep costs one night, not every night after.
    const claimed = await this.redis.set('retention:lock', '1', 'EX', LOCK_SECONDS, 'NX');

    if (claimed !== 'OK') {
      this.logger.debug('another instance is running the retention sweep');
      return;
    }

    try {
      const result = await this.sweep();

      if (result.deleted > 0 || result.objectFailures > 0) {
        this.logger.log(
          `retention: removed ${result.deleted} document(s), ${result.objectsRemoved} object(s), ${result.objectFailures} object failure(s)`,
        );
      }
    } finally {
      await this.redis.del('retention:lock').catch(() => undefined);
    }
  }

  /** Exposed so the sweep can be run and asserted on without waiting for 3am. */
  async sweep(now = new Date()): Promise<SweepResult> {
    const result: SweepResult = { deleted: 0, objectsRemoved: 0, objectFailures: 0 };

    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const expired = await this.prisma.document.findMany({
        where: { expiresAt: { not: null, lte: now } },
        select: { id: true, storageKey: true },
        orderBy: { expiresAt: 'asc' },
        take: BATCH_SIZE,
      });

      if (expired.length === 0) break;

      const removable: string[] = [];

      for (const document of expired) {
        if (!document.storageKey) {
          // A failed render never stored anything; the row alone goes.
          removable.push(document.id);
          continue;
        }

        try {
          await this.storage.deletePdf(document.storageKey);
          result.objectsRemoved += 1;
          removable.push(document.id);
        } catch (error) {
          // Leave the row so the next sweep tries again rather than losing
          // track of an object that is still costing money.
          result.objectFailures += 1;
          this.logger.warn({ err: error }, `could not delete ${document.storageKey}`);
        }
      }

      if (removable.length > 0) {
        const { count } = await this.prisma.document.deleteMany({
          where: { id: { in: removable } },
        });
        result.deleted += count;
      }

      // Everything left in this batch failed its object delete; another pass
      // would fetch the same rows and fail identically.
      if (removable.length === 0) break;
    }

    return result;
  }
}
