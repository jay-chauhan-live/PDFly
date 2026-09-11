import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import type { Redis } from 'ioredis';

export interface UsageTotals {
  renders: number;
  pages: number;
  bytes: number;
  failures: number;
}

export interface UsageDay extends UsageTotals {
  date: string;
}

const DIRTY_SET = 'usage:dirty';

/**
 * Drains one day's counters atomically.
 *
 * HGETALL then DEL as separate calls would lose every increment that landed
 * between them — a small, permanent undercount that nothing would ever
 * reconcile. Taking the hash and removing it in one script means an increment
 * either makes this flush or the next one.
 *
 * KEYS[1] the day's hash
 */
const DRAIN = `
local counters = redis.call('HGETALL', KEYS[1])
if #counters > 0 then redis.call('DEL', KEYS[1]) end
return counters
`;

declare module 'ioredis' {
  interface RedisCommander {
    drainUsage(key: string): Promise<string[]>;
  }
}

/**
 * Usage metering (PLAN §4, §8).
 *
 * Counters are incremented in Redis and flushed to `usage_daily` on a timer.
 * The dashboard never counts the documents table: that query gets slower
 * exactly as an organization gets more valuable, and it would be running on
 * every page load.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.redis.defineCommand('drainUsage', { numberOfKeys: 1, lua: DRAIN });
  }

  private key(orgId: string, date: string): string {
    return `usage:${orgId}:${date}`;
  }

  /** UTC, so a day means the same thing regardless of where the server is. */
  static today(at = new Date()): string {
    return at.toISOString().slice(0, 10);
  }

  async recordRender(
    orgId: string,
    outcome: { pages: number; bytes: number; failed: boolean },
  ): Promise<void> {
    const date = UsageService.today();
    const key = this.key(orgId, date);

    try {
      await this.redis
        .multi()
        .hincrby(key, 'renders', 1)
        .hincrby(key, 'pages', outcome.pages)
        .hincrby(key, 'bytes', outcome.bytes)
        .hincrby(key, 'failures', outcome.failed ? 1 : 0)
        // Outlives any plausible flush outage, so nothing is lost if the timer
        // stops; the flush deletes the key anyway.
        .expire(key, 7 * 24 * 60 * 60)
        .sadd(DIRTY_SET, `${orgId}:${date}`)
        .exec();
    } catch (error) {
      // Metering must never fail a render that already produced a PDF.
      this.logger.warn({ err: error }, `could not record usage for org ${orgId}`);
    }
  }

  /**
   * Moves Redis counters into `usage_daily`. Runs on every instance; the
   * upsert increments rather than overwrites, so concurrent flushes of
   * different slices of the same day add up correctly.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async flush(): Promise<void> {
    let pending: string[];

    try {
      pending = await this.redis.spop(DIRTY_SET, 100);
    } catch (error) {
      this.logger.warn({ err: error }, 'could not read the usage flush queue');
      return;
    }

    for (const entry of pending) {
      const separator = entry.lastIndexOf(':');
      const orgId = entry.slice(0, separator);
      const date = entry.slice(separator + 1);

      try {
        await this.flushOne(orgId, date);
      } catch (error) {
        this.logger.error({ err: error }, `could not flush usage for ${entry}`);
        // Put it back so the next tick retries rather than dropping the day.
        await this.redis.sadd(DIRTY_SET, entry).catch(() => undefined);
      }
    }
  }

  private async flushOne(orgId: string, date: string): Promise<void> {
    const drained = await this.redis.drainUsage(this.key(orgId, date));
    if (drained.length === 0) return;

    const counters = toTotals(drained);

    await this.prisma.usageDaily.upsert({
      where: { orgId_date: { orgId, date: new Date(`${date}T00:00:00.000Z`) } },
      create: {
        orgId,
        date: new Date(`${date}T00:00:00.000Z`),
        renders: counters.renders,
        pages: counters.pages,
        bytes: BigInt(counters.bytes),
        failures: counters.failures,
      },
      update: {
        renders: { increment: counters.renders },
        pages: { increment: counters.pages },
        bytes: { increment: BigInt(counters.bytes) },
        failures: { increment: counters.failures },
      },
    });

    this.logger.debug(`flushed ${counters.renders} render(s) for ${orgId} on ${date}`);
  }

  /**
   * Rolled-up history plus whatever has not been flushed yet, so a render
   * that happened ten seconds ago still shows up in the numbers.
   *
   * The series is dense: every day in the range is present, zero-filled. A
   * caller plotting this should not have to reconstruct the missing days, and
   * a chart built from only the days that happened to have traffic silently
   * misrepresents a quiet week as a busy one.
   */
  async daily(orgId: string, days: number): Promise<UsageDay[]> {
    const from = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);
    from.setUTCHours(0, 0, 0, 0);

    const rows = await this.prisma.usageDaily.findMany({
      where: { orgId, date: { gte: from } },
      orderBy: { date: 'asc' },
    });

    const byDate = new Map<string, UsageDay>();

    for (const date of datesFrom(from)) {
      byDate.set(date, { date, renders: 0, pages: 0, bytes: 0, failures: 0 });
    }

    for (const row of rows) {
      const date = row.date.toISOString().slice(0, 10);
      byDate.set(date, {
        date,
        renders: row.renders,
        pages: row.pages,
        bytes: Number(row.bytes),
        failures: row.failures,
      });
    }

    await this.mergeUnflushed(orgId, from, byDate);

    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  private async mergeUnflushed(
    orgId: string,
    from: Date,
    byDate: Map<string, UsageDay>,
  ): Promise<void> {
    const dates = datesFrom(from);

    // Reads without draining: the flush owns deletion, and a dashboard load
    // must not swallow counters the database has not seen yet.
    const live = await Promise.all(dates.map((date) => this.redis.hgetall(this.key(orgId, date))));

    dates.forEach((date, index) => {
      const counters = live[index];
      if (!counters || Object.keys(counters).length === 0) return;

      const pending = toTotals(Object.entries(counters).flat());
      const existing = byDate.get(date) ?? { date, renders: 0, pages: 0, bytes: 0, failures: 0 };

      byDate.set(date, {
        date,
        renders: existing.renders + pending.renders,
        pages: existing.pages + pending.pages,
        bytes: existing.bytes + pending.bytes,
        failures: existing.failures + pending.failures,
      });
    });
  }
}

/** Every UTC date from `from` up to and including today. */
function datesFrom(from: Date): string[] {
  const dates: string[] = [];
  const today = UsageService.today();

  for (const day = new Date(from); ; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    dates.push(date);
    if (date >= today) break;
  }

  return dates;
}

/** Redis returns a flat [field, value, field, value] array. */
function toTotals(flat: string[]): UsageTotals {
  const totals: UsageTotals = { renders: 0, pages: 0, bytes: 0, failures: 0 };

  for (let i = 0; i < flat.length; i += 2) {
    const field = flat[i];
    const value = Number(flat[i + 1] ?? 0);

    if (field === 'renders') totals.renders = value;
    else if (field === 'pages') totals.pages = value;
    else if (field === 'bytes') totals.bytes = value;
    else if (field === 'failures') totals.failures = value;
  }

  return totals;
}
