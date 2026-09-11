import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { RetentionService } from './retention.service.js';
import type { ConfigService } from '@nestjs/config';
import type { StorageService } from '../storage/storage.service.js';
import type { Env } from '../config/env.schema.js';

/**
 * Against the real database. Retention is a promise as much as a cost
 * control, and "did the row actually go" is a question only Postgres answers.
 */
const prisma = new PrismaService();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
});

let deleted: string[] = [];
let failOn: string | null = null;

const storage = {
  deletePdf: (key: string) => {
    if (key === failOn) return Promise.reject(new Error('storage is unavailable'));
    deleted.push(key);
    return Promise.resolve();
  },
} as unknown as StorageService;

const config = { get: () => true } as unknown as ConfigService<Env, true>;
const service = new RetentionService(prisma, storage, redis, config);

let orgId: string;

const ago = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const ahead = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

async function makeDocument(expiresAt: Date | null, storageKey: string | null = 'org/x/file.pdf') {
  return prisma.document.create({
    data: { orgId, source: 'api', status: 'completed', expiresAt, storageKey },
    select: { id: true },
  });
}

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: 'Retention', slug: `retention-${randomUUID()}` },
    select: { id: true },
  });
  orgId = org.id;
});

beforeEach(async () => {
  deleted = [];
  failOn = null;
  await prisma.document.deleteMany({ where: { orgId } });
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
  await redis.quit();
});

describe('RetentionService.sweep', () => {
  it('removes a document past its expiry, and the object behind it', async () => {
    const document = await makeDocument(ago(1), 'org/x/expired.pdf');

    const result = await service.sweep();

    expect(result.deleted).toBe(1);
    expect(deleted).toContain('org/x/expired.pdf');
    expect(await prisma.document.findUnique({ where: { id: document.id } })).toBeNull();
  });

  it('leaves a document that has not expired yet', async () => {
    const document = await makeDocument(ahead(3));

    const result = await service.sweep();

    expect(result.deleted).toBe(0);
    expect(deleted).toHaveLength(0);
    expect(await prisma.document.findUnique({ where: { id: document.id } })).not.toBeNull();
  });

  it('leaves a document with no expiry at all', async () => {
    // Null means "keep indefinitely", not "expired at the beginning of time".
    const document = await makeDocument(null);

    await service.sweep();

    expect(await prisma.document.findUnique({ where: { id: document.id } })).not.toBeNull();
  });

  it('deletes the row of a failed render that never stored anything', async () => {
    const document = await makeDocument(ago(1), null);

    const result = await service.sweep();

    expect(result.deleted).toBe(1);
    expect(result.objectsRemoved).toBe(0);
    expect(await prisma.document.findUnique({ where: { id: document.id } })).toBeNull();
  });

  it('keeps the row when its object could not be deleted, so the next sweep retries', async () => {
    failOn = 'org/x/stubborn.pdf';
    const document = await makeDocument(ago(1), 'org/x/stubborn.pdf');

    const result = await service.sweep();

    // Deleting the row first would orphan the object permanently, with
    // nothing left pointing at it and nothing to retry from.
    expect(result.objectFailures).toBe(1);
    expect(result.deleted).toBe(0);
    expect(await prisma.document.findUnique({ where: { id: document.id } })).not.toBeNull();

    // And the retry works once storage comes back.
    failOn = null;
    expect((await service.sweep()).deleted).toBe(1);
  });

  it('sweeps a mixed batch without touching what should survive', async () => {
    const doomed = await Promise.all([
      makeDocument(ago(5), 'org/x/a.pdf'),
      makeDocument(ago(2), 'org/x/b.pdf'),
    ]);
    const safe = await Promise.all([makeDocument(ahead(1)), makeDocument(null)]);

    const result = await service.sweep();

    expect(result.deleted).toBe(2);
    expect(deleted.sort()).toEqual(['org/x/a.pdf', 'org/x/b.pdf']);

    for (const document of doomed) {
      expect(await prisma.document.findUnique({ where: { id: document.id } })).toBeNull();
    }
    for (const document of safe) {
      expect(await prisma.document.findUnique({ where: { id: document.id } })).not.toBeNull();
    }
  });

  it('does nothing on an empty sweep', async () => {
    expect(await service.sweep()).toEqual({ deleted: 0, objectsRemoved: 0, objectFailures: 0 });
  });
});

describe('RetentionService.nightly', () => {
  it('lets only one instance sweep at a time', async () => {
    await redis.del('retention:lock');
    await makeDocument(ago(1), 'org/x/contended.pdf');

    // Two instances wake at 3am; the second must find the work already claimed.
    await Promise.all([service.nightly(), service.nightly()]);

    expect(deleted.filter((key) => key === 'org/x/contended.pdf')).toHaveLength(1);
  });

  it('releases the lock so the next night can sweep', async () => {
    await redis.del('retention:lock');

    await service.nightly();

    expect(await redis.get('retention:lock')).toBeNull();
  });
});
