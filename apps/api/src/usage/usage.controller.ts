import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CurrentContext } from '../auth/current-context.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService, type UsageDay } from './usage.service.js';
import type { RequestContext } from '../auth/request-context.js';

class UsageQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;
}

/** The dashboard's overview numbers, and what a customer would be billed on. */
@Controller('usage')
export class UsageController {
  constructor(
    private readonly usage: UsageService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async current(@CurrentContext() ctx: RequestContext, @Query() query: UsageQuery) {
    const days = query.days ?? 30;
    const daily = await this.usage.daily(ctx.orgId, days);

    const today = UsageService.today();
    const monthPrefix = today.slice(0, 7);

    return {
      today: daily.find((day) => day.date === today) ?? empty(today),
      month: total(daily.filter((day) => day.date.startsWith(monthPrefix))),
      period: total(daily),
      daily,
      // Duration is not a counter, so it is not in usage_daily. It comes from
      // the day's documents, which is a small, indexed range scan.
      performance: await this.todayPerformance(ctx.orgId),
    };
  }

  /**
   * Render durations for today (PLAN §9).
   *
   * Duration is a distribution, not a counter, so it cannot live in
   * `usage_daily` alongside the tallies — it comes from the day's documents,
   * which is a small indexed range scan. `percentile_cont` runs in Postgres
   * rather than pulling every duration into the api: the rows are already
   * there, and the answer is one number.
   *
   * Counts are returned too, but the dashboard takes its success rate from
   * the usage counters so that two cards describing the same events agree.
   */
  private async todayPerformance(orgId: string) {
    const since = new Date(`${UsageService.today()}T00:00:00.000Z`);

    const [row] = await this.prisma.$queryRaw<
      { total: bigint; failed: bigint; p95: number | null; p50: number | null }[]
    >`
      SELECT
        COUNT(*)                                                              AS total,
        COUNT(*) FILTER (WHERE status = 'failed')                             AS failed,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)             AS p95,
        PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY duration_ms)             AS p50
      FROM documents
      WHERE org_id = ${orgId}::uuid
        AND created_at >= ${since}
    `;

    const total = Number(row?.total ?? 0);
    const failed = Number(row?.failed ?? 0);

    return {
      total,
      failed,
      // An organization that has rendered nothing today has not failed at
      // anything; reporting 0% success would be a lie a dashboard tells.
      successRate: total === 0 ? null : (total - failed) / total,
      p50DurationMs: row?.p50 === null || row?.p50 === undefined ? null : Math.round(row.p50),
      p95DurationMs: row?.p95 === null || row?.p95 === undefined ? null : Math.round(row.p95),
    };
  }
}

function empty(date: string): UsageDay {
  return { date, renders: 0, pages: 0, bytes: 0, failures: 0 };
}

function total(days: UsageDay[]) {
  return days.reduce(
    (sum, day) => ({
      renders: sum.renders + day.renders,
      pages: sum.pages + day.pages,
      bytes: sum.bytes + day.bytes,
      failures: sum.failures + day.failures,
    }),
    { renders: 0, pages: 0, bytes: 0, failures: 0 },
  );
}
