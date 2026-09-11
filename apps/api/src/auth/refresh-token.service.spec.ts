import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { RefreshTokenService } from './refresh-token.service.js';
import type { ConfigService } from '@nestjs/config';

/**
 * Exercised against a real Redis, not a fake.
 *
 * Rotation is an atomic Lua script — the whole point of it is behaviour under
 * concurrency, which a hand-written fake cannot reproduce: it would only prove
 * that a JavaScript transliteration of the script agrees with itself. Run
 * `pnpm infra:up` first; CI provides a Redis service container.
 */
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});

const config = { get: () => 30 } as unknown as ConfigService<never, true>;

afterAll(async () => {
  await redis.quit();
});

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;
  let userId: string;

  beforeEach(() => {
    // A fresh id per test, so runs cannot collide in a shared Redis.
    userId = `test-${randomUUID()}`;
    service = new RefreshTokenService(redis, config);
  });

  it('never stores the secret itself, only its digest', async () => {
    const { token, familyId } = await service.issue(userId, 'org-1');
    const secret = token.slice(token.indexOf('.') + 1);

    const stored = await redis.get(`refresh:${familyId}`);

    expect(stored).not.toBeNull();
    expect(stored).not.toContain(secret);
  });

  it('rotates the secret but keeps the family', async () => {
    const issued = await service.issue(userId, 'org-1');
    const result = await service.rotate(issued.token);

    expect(result.outcome).toBe('rotated');
    if (result.outcome !== 'rotated') return;

    expect(result.issued.token).not.toBe(issued.token);
    expect(result.issued.familyId).toBe(issued.familyId);
    expect(result.family.generation).toBe(2);
  });

  it('treats a token superseded moments ago as a race, not an attack', async () => {
    // Two tabs restoring at once both present the cookie they share. The
    // loser must not take the session down with it.
    const issued = await service.issue(userId, 'org-1');
    const winner = await service.rotate(issued.token);
    const loser = await service.rotate(issued.token);

    expect(winner.outcome).toBe('rotated');
    expect(loser.outcome).toBe('concurrent');

    // The winner's token — the one now in the browser's cookie — still works.
    if (winner.outcome !== 'rotated') return;
    expect((await service.rotate(winner.issued.token)).outcome).toBe('rotated');
  });

  it('makes exactly one of two simultaneous refreshes the rotation', async () => {
    const issued = await service.issue(userId, 'org-1');

    // Genuinely in flight together, which is what read-then-write got wrong:
    // both callers would have rotated, orphaning one of the two new tokens.
    const results = await Promise.all([
      service.rotate(issued.token),
      service.rotate(issued.token),
      service.rotate(issued.token),
    ]);

    const outcomes = results.map((r) => r.outcome).sort();
    expect(outcomes).toEqual(['concurrent', 'concurrent', 'rotated']);

    // And the token that rotation handed out is the one the family knows.
    const winner = results.find((r) => r.outcome === 'rotated');
    if (winner?.outcome !== 'rotated') throw new Error('expected one rotation');
    expect((await service.rotate(winner.issued.token)).outcome).toBe('rotated');
  });

  it('detects reuse of a long-superseded token and revokes the whole family', async () => {
    const issued = await service.issue(userId, 'org-1');
    const rotated = await service.rotate(issued.token);
    if (rotated.outcome !== 'rotated') throw new Error('expected a rotation');

    // Push the rotation out of the grace window: this is a replay, which is
    // what reuse detection exists for.
    await ageRotationBeyondGrace(issued.familyId);

    expect((await service.rotate(issued.token)).outcome).toBe('reused');

    // And the user's current, legitimate token dies with the family — we
    // cannot tell the two holders apart, so neither may continue.
    expect((await service.rotate(rotated.issued.token)).outcome).toBe('unknown');
  });

  it('never accepts a generation older than the one just replaced', async () => {
    const first = await service.issue(userId, 'org-1');
    const second = await service.rotate(first.token);
    if (second.outcome !== 'rotated') throw new Error('expected a rotation');
    const third = await service.rotate(second.issued.token);
    if (third.outcome !== 'rotated') throw new Error('expected a rotation');

    // Two generations back, even within the grace window.
    expect((await service.rotate(first.token)).outcome).toBe('reused');
  });

  it('reports an unknown family rather than throwing', async () => {
    expect((await service.rotate('not-a-token')).outcome).toBe('unknown');
    expect((await service.rotate(`${randomUUID()}.x`)).outcome).toBe('unknown');
  });

  it('revokes every session a user holds, for password changes', async () => {
    const first = await service.issue(userId, 'org-1');
    const second = await service.issue(userId, 'org-1');

    const otherUser = `test-${randomUUID()}`;
    const other = await new RefreshTokenService(redis, config).issue(otherUser, 'org-1');

    expect(await service.revokeAllForUser(userId)).toBe(2);

    expect((await service.rotate(first.token)).outcome).toBe('unknown');
    expect((await service.rotate(second.token)).outcome).toBe('unknown');
    // Another user's session is untouched.
    expect((await service.rotate(other.token)).outcome).toBe('rotated');
  });
});

/** Backdates the last rotation so the grace window has demonstrably passed. */
async function ageRotationBeyondGrace(familyId: string): Promise<void> {
  const key = `refresh:${familyId}`;
  const raw = await redis.get(key);
  if (!raw) throw new Error(`family ${familyId} is gone`);

  const family = JSON.parse(raw) as { rotatedAt?: number };
  const ttl = await redis.ttl(key);

  await redis.set(key, JSON.stringify({ ...family, rotatedAt: Date.now() - 60_000 }), 'EX', ttl);
}
