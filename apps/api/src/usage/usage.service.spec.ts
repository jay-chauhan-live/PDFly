import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from './usage.service.js';

/**
 * Against the real database and Redis. The behaviour worth testing is that
 * nothing is lost between the counter and the rollup, which is a property of
 * the drain script and the incrementing upsert — neither of which survives
 * being mocked.
 */
const prisma = new PrismaService();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
});

const service = new UsageService(prisma, redis);

let orgId: string;

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: 'Usage test', slug: `usage-${randomUUID()}` },
    select: { id: true },
  });
  orgId = org.id;
});

afterAll(async () => {
  await redis.del(`usage:${orgId}:${UsageService.today()}`);
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
  await redis.quit();
});

describe('UsageService', () => {
  it('counts renders, pages, bytes and failures separately', async () => {
    await service.recordRender(orgId, { pages: 3, bytes: 1000, failed: false });
    await service.recordRender(orgId, { pages: 2, bytes: 500, failed: false });
    await service.recordRender(orgId, { pages: 0, bytes: 0, failed: true });

    const [today] = await service.daily(orgId, 1);

    expect(today).toMatchObject({ renders: 3, pages: 5, bytes: 1500, failures: 1 });
  });

  it('reports counters that have not reached the database yet', async () => {
    // A render ten seconds ago must show up on the dashboard, not a minute
    // later when the flush happens to run.
    const before = (await service.daily(orgId, 1))[0]?.renders ?? 0;

    await service.recordRender(orgId, { pages: 1, bytes: 10, failed: false });

    expect((await service.daily(orgId, 1))[0]?.renders).toBe(before + 1);
  });

  it('moves counters into usage_daily without changing the totals', async () => {
    const beforeFlush = (await service.daily(orgId, 1))[0];

    await service.flush();

    const row = await prisma.usageDaily.findFirst({ where: { orgId } });
    expect(row).not.toBeNull();
    expect(row?.renders).toBe(beforeFlush?.renders);
    expect(Number(row?.bytes)).toBe(beforeFlush?.bytes);

    // And the reported total is unchanged: the numbers moved, they did not
    // double or vanish.
    const afterFlush = (await service.daily(orgId, 1))[0];
    expect(afterFlush).toMatchObject({
      renders: beforeFlush?.renders,
      pages: beforeFlush?.pages,
      bytes: beforeFlush?.bytes,
    });
  });

  it('adds to the existing row rather than overwriting it', async () => {
    const before = (await service.daily(orgId, 1))[0]?.renders ?? 0;

    await service.recordRender(orgId, { pages: 1, bytes: 1, failed: false });
    await service.flush();

    const row = await prisma.usageDaily.findFirstOrThrow({ where: { orgId } });

    expect(row.renders).toBe(before + 1);
  });

  it('loses nothing when a render lands during a flush', async () => {
    const before = (await service.daily(orgId, 1))[0]?.renders ?? 0;

    // Interleaved on purpose: the drain has to be atomic or these increments
    // fall into the gap between reading the hash and deleting it.
    await Promise.all([
      service.recordRender(orgId, { pages: 1, bytes: 1, failed: false }),
      service.flush(),
      service.recordRender(orgId, { pages: 1, bytes: 1, failed: false }),
      service.flush(),
      service.recordRender(orgId, { pages: 1, bytes: 1, failed: false }),
    ]);

    await service.flush();

    expect((await service.daily(orgId, 1))[0]?.renders).toBe(before + 3);
  });

  it('keeps one organization’s usage out of another’s', async () => {
    const other = await prisma.organization.create({
      data: { name: 'Neighbour', slug: `neighbour-${randomUUID()}` },
      select: { id: true },
    });

    await service.recordRender(other.id, { pages: 9, bytes: 9, failed: false });
    await service.flush();

    const mine = (await service.daily(orgId, 1))[0];
    const theirs = (await service.daily(other.id, 1))[0];

    expect(theirs?.pages).toBe(9);
    expect(mine?.pages).not.toBe(9);

    await redis.del(`usage:${other.id}:${UsageService.today()}`);
    await prisma.organization.delete({ where: { id: other.id } });
  });
});
