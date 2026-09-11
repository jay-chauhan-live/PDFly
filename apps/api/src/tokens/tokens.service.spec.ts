import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { TokensService } from './tokens.service.js';
import { mintToken } from './token.format.js';

/**
 * Against the real database and Redis: verification is an indexed lookup plus
 * a digest comparison, and the throttling of `last_used_at` is a Redis
 * behaviour. Run `pnpm infra:up` first; CI provides both.
 */
const prisma = new PrismaService();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
});

const service = new TokensService(prisma, redis);

/** base64url secrets can contain '_', so never split the token on it. */
const secretOf = (token: string) => token.slice(token.indexOf('_', 'pdfly_live_'.length) + 1);

let orgId: string;
let userId: string;

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: 'Tokens test', slug: `tokens-${randomUUID()}` },
    select: { id: true },
  });
  orgId = org.id;

  const user = await prisma.user.create({
    data: { orgId, email: `${randomUUID()}@example.com`, passwordHash: 'x', name: 'Tester' },
    select: { id: true },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
  await redis.quit();
});

describe('TokensService.create', () => {
  it('returns the token once and stores only its digest', async () => {
    const created = await service.create(orgId, { name: 'CI', scopes: ['pdf:render'] }, userId);

    const stored = await prisma.apiToken.findUniqueOrThrow({
      where: { id: created.id },
      select: { tokenHash: true, prefix: true, scopes: true, createdBy: true },
    });

    const secret = secretOf(created.token);
    expect(secret.length).toBeGreaterThan(0);
    expect(stored.tokenHash).not.toContain(secret);
    expect(created.token).toContain(stored.prefix);
    expect(stored.scopes).toEqual(['pdf:render']);
    expect(stored.createdBy).toBe(userId);
  });

  it('never shows the secret again through the listing', async () => {
    const created = await service.create(orgId, { name: 'Listed', scopes: ['pdf:render'] }, userId);
    const secret = secretOf(created.token);

    const listed = await service.list(orgId);

    expect(JSON.stringify(listed)).not.toContain(secret);
    expect(listed.find((t) => t.id === created.id)?.masked).toContain(created.prefix);
  });

  it('records who minted it', async () => {
    const created = await service.create(
      orgId,
      { name: 'Audited', scopes: ['pdf:render'] },
      userId,
    );

    const audit = await prisma.auditLogEntry.findFirst({
      where: { orgId, action: 'token.create', target: created.id },
    });

    expect(audit?.actorId).toBe(userId);
  });
});

describe('TokensService.authenticate', () => {
  it('resolves a valid token into its organization and scopes', async () => {
    const created = await service.create(
      orgId,
      { name: 'Valid', scopes: ['pdf:render', 'documents:read'] },
      userId,
    );

    const ctx = await service.authenticate(created.token);

    expect(ctx).toEqual({
      orgId,
      tokenId: created.id,
      scopes: ['pdf:render', 'documents:read'],
    });
    // An API token has no person behind it.
    expect(ctx.userId).toBeUndefined();
  });

  it('rejects a token whose secret is wrong, even with a real prefix', async () => {
    const created = await service.create(orgId, { name: 'Tamper', scopes: ['pdf:render'] }, userId);
    const tampered = `pdfly_live_${created.prefix}_${'a'.repeat(43)}`;

    await expect(service.authenticate(tampered)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects an unknown prefix and a malformed value alike', async () => {
    await expect(
      service.authenticate(`pdfly_live_zzzzzzzz_${'b'.repeat(43)}`),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(service.authenticate('nonsense')).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects a revoked token', async () => {
    const created = await service.create(orgId, { name: 'Doomed', scopes: ['pdf:render'] }, userId);
    await service.revoke(orgId, created.id, userId);

    await expect(service.authenticate(created.token)).rejects.toMatchObject({
      detail: expect.stringContaining('revoked') as unknown,
    });
  });

  it('rejects an expired token', async () => {
    const expired = mintToken();
    const record = await prisma.apiToken.create({
      data: {
        orgId,
        name: 'Expired',
        prefix: expired.prefix,
        tokenHash: expired.hash,
        scopes: ['pdf:render'],
        expiresAt: new Date(Date.now() - 1000),
      },
      select: { id: true },
    });

    await expect(service.authenticate(expired.token)).rejects.toMatchObject({
      detail: expect.stringContaining('expired') as unknown,
    });

    await prisma.apiToken.delete({ where: { id: record.id } });
  });

  it('records last use, but not on every single request', async () => {
    const created = await service.create(
      orgId,
      { name: 'Touched', scopes: ['pdf:render'] },
      userId,
    );
    await redis.del(`token:touched:${created.id}`);

    await service.authenticate(created.token);
    // The write is deliberately not awaited by authenticate.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const first = await prisma.apiToken.findUniqueOrThrow({
      where: { id: created.id },
      select: { lastUsedAt: true },
    });
    expect(first.lastUsedAt).not.toBeNull();

    // A second use inside the throttle window must not write again.
    await prisma.apiToken.update({
      where: { id: created.id },
      data: { lastUsedAt: new Date(0) },
    });
    await service.authenticate(created.token);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const second = await prisma.apiToken.findUniqueOrThrow({
      where: { id: created.id },
      select: { lastUsedAt: true },
    });
    expect(second.lastUsedAt?.getTime()).toBe(0);
  });
});

describe('TokensService.revoke', () => {
  it('tombstones rather than deletes, so the audit log still resolves', async () => {
    const created = await service.create(
      orgId,
      { name: 'Tombstone', scopes: ['pdf:render'] },
      userId,
    );

    const revoked = await service.revoke(orgId, created.id, userId);

    expect(revoked.revokedAt).not.toBeNull();
    expect(await prisma.apiToken.findUnique({ where: { id: created.id } })).not.toBeNull();
  });

  it('is idempotent', async () => {
    const created = await service.create(orgId, { name: 'Twice', scopes: ['pdf:render'] }, userId);

    const first = await service.revoke(orgId, created.id, userId);
    const second = await service.revoke(orgId, created.id, userId);

    expect(second.revokedAt?.getTime()).toBe(first.revokedAt?.getTime());
  });

  it('will not revoke another organization’s token', async () => {
    const other = await prisma.organization.create({
      data: { name: 'Other', slug: `other-${randomUUID()}` },
      select: { id: true },
    });
    const created = await service.create(orgId, { name: 'Mine', scopes: ['pdf:render'] }, userId);

    await expect(service.revoke(other.id, created.id)).rejects.toMatchObject({ status: 404 });

    // And it still works.
    await expect(service.authenticate(created.token)).resolves.toMatchObject({ orgId });

    await prisma.organization.delete({ where: { id: other.id } });
  });
});
