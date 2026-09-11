import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import type { Env } from '../config/env.schema.js';

export interface RefreshFamily {
  userId: string;
  orgId: string;
  /** sha256 of the currently valid secret. The secret itself is never stored. */
  hash: string;
  generation: number;
  /** sha256 of the secret this one replaced, honoured briefly — see GRACE_MS. */
  previousHash?: string;
  /** When the rotation happened, as epoch milliseconds. */
  rotatedAt?: number;
}

export interface IssuedRefreshToken {
  /** The opaque value handed to the browser: `<familyId>.<secret>`. */
  token: string;
  familyId: string;
}

export type RotationResult =
  | { outcome: 'rotated'; issued: IssuedRefreshToken; family: RefreshFamily }
  /** A race, not an attack: the caller gets an access token and keeps its cookie. */
  | { outcome: 'concurrent'; family: RefreshFamily }
  | { outcome: 'unknown' }
  | { outcome: 'reused' };

/**
 * How long the just-replaced secret still answers.
 *
 * Two browser tabs restoring at the same moment both present the cookie they
 * share, and the loser would otherwise look exactly like a replayed token and
 * take the whole family down with it. A few seconds covers that race while
 * leaving a leaked token — replayed minutes or hours later, which is the case
 * reuse detection exists for — just as fatal.
 */
const GRACE_MS = 10_000;

/**
 * Rotation has to be atomic.
 *
 * Read-then-write loses races: two refreshes arriving together both read the
 * same current hash, both believe they won, and both write — leaving one
 * caller holding a token the family has never heard of, which reads as reuse
 * and takes the session down minutes later. Doing the compare and the write
 * inside one script makes exactly one of them the rotation and the other a
 * recognised concurrent read.
 *
 * The comparison is a plain string equality rather than a constant-time one.
 * What is compared is a sha256 digest of 256 bits of entropy, so an attacker
 * who could exploit the timing would have to already know the secret.
 *
 * KEYS[1] family key
 * ARGV    presentedHash, nextHash, nowMs, graceMs, fallbackTtlSeconds
 */
const ROTATE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({ outcome = 'unknown' }) end

local family = cjson.decode(raw)
local now = tonumber(ARGV[3])

if family.hash == ARGV[1] then
  family.previousHash = family.hash
  family.hash = ARGV[2]
  family.rotatedAt = now
  family.generation = family.generation + 1

  -- Keep the original expiry window rather than extending it on every refresh.
  local ttl = redis.call('TTL', KEYS[1])
  if ttl == nil or ttl <= 0 then ttl = tonumber(ARGV[5]) end
  redis.call('SET', KEYS[1], cjson.encode(family), 'EX', ttl)

  return cjson.encode({ outcome = 'rotated', family = family })
end

if family.previousHash == ARGV[1] and (now - (family.rotatedAt or 0)) <= tonumber(ARGV[4]) then
  return cjson.encode({ outcome = 'concurrent', family = family })
end

-- Superseded or forged: the whole family goes.
redis.call('DEL', KEYS[1])
return cjson.encode({ outcome = 'reused', userId = family.userId })
`;

declare module 'ioredis' {
  interface RedisCommander {
    rotateRefreshFamily(
      key: string,
      presentedHash: string,
      nextHash: string,
      nowMs: string,
      graceMs: string,
      fallbackTtlSeconds: string,
    ): Promise<string>;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Rotating refresh tokens with family-wide revocation on reuse (PLAN §5).
 *
 * Each login starts a family. Every refresh replaces the family's secret, so
 * a token is valid exactly once. Presenting a superseded token means it either
 * leaked or was replayed — the whole family is destroyed rather than just that
 * token, because we cannot tell the attacker's copy from the user's.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);
  private readonly ttlSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.ttlSeconds = config.get('REFRESH_TTL_DAYS', { infer: true }) * 24 * 60 * 60;

    this.redis.defineCommand('rotateRefreshFamily', { numberOfKeys: 1, lua: ROTATE_SCRIPT });
  }

  private key(familyId: string): string {
    return `refresh:${familyId}`;
  }

  /** Index of a user's live families, so all sessions can be revoked at once. */
  private userKey(userId: string): string {
    return `refresh:user:${userId}`;
  }

  async issue(userId: string, orgId: string): Promise<IssuedRefreshToken> {
    const familyId = randomUUID();
    const secret = randomBytes(32).toString('base64url');

    const family: RefreshFamily = { userId, orgId, hash: sha256(secret), generation: 1 };

    await this.redis
      .multi()
      .set(this.key(familyId), JSON.stringify(family), 'EX', this.ttlSeconds)
      .sadd(this.userKey(userId), familyId)
      .expire(this.userKey(userId), this.ttlSeconds)
      .exec();

    return { token: `${familyId}.${secret}`, familyId };
  }

  async rotate(presented: string): Promise<RotationResult> {
    const separator = presented.indexOf('.');
    if (separator === -1) return { outcome: 'unknown' };

    const familyId = presented.slice(0, separator);
    const secret = presented.slice(separator + 1);
    const nextSecret = randomBytes(32).toString('base64url');

    const raw = (await this.redis.rotateRefreshFamily(
      this.key(familyId),
      sha256(secret),
      sha256(nextSecret),
      Date.now().toString(),
      GRACE_MS.toString(),
      this.ttlSeconds.toString(),
    )) as string;

    const result = JSON.parse(raw) as
      | { outcome: 'unknown' }
      | { outcome: 'reused'; userId: string }
      | { outcome: 'rotated' | 'concurrent'; family: RefreshFamily };

    if (result.outcome === 'unknown') return { outcome: 'unknown' };

    if (result.outcome === 'reused') {
      // The family row is already gone; drop it from the user's index too.
      await this.redis.srem(this.userKey(result.userId), familyId);
      this.logger.warn(`refresh token reuse detected; revoked family ${familyId}`);
      return { outcome: 'reused' };
    }

    if (result.outcome === 'concurrent') {
      this.logger.debug(`concurrent refresh for family ${familyId}`);
      return { outcome: 'concurrent', family: result.family };
    }

    return {
      outcome: 'rotated',
      issued: { token: `${familyId}.${nextSecret}`, familyId },
      family: result.family,
    };
  }

  async revoke(presented: string): Promise<void> {
    const separator = presented.indexOf('.');
    const familyId = separator === -1 ? presented : presented.slice(0, separator);

    const raw = await this.redis.get(this.key(familyId));
    const userId = raw ? (JSON.parse(raw) as RefreshFamily).userId : null;

    const pipeline = this.redis.multi().del(this.key(familyId));
    if (userId) pipeline.srem(this.userKey(userId), familyId);
    await pipeline.exec();
  }

  /**
   * Ends every session a user has. Called when the password changes: an
   * attacker holding a stolen refresh token must not survive the reset.
   */
  async revokeAllForUser(userId: string): Promise<number> {
    const familyIds = await this.redis.smembers(this.userKey(userId));

    if (familyIds.length === 0) return 0;

    await this.redis
      .multi()
      .del(...familyIds.map((id) => this.key(id)))
      .del(this.userKey(userId))
      .exec();

    return familyIds.length;
  }
}
