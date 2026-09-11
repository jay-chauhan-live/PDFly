import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CryptoService } from '../common/crypto.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import type { Redis } from 'ioredis';
import type { ProtectionDto } from '../pdf/dto/render-pdf.dto.js';

/**
 * Long enough for a queued render to be picked up and run, short enough that
 * a secret does not outlive the job that needed it by any meaningful margin.
 */
const TTL_SECONDS = 15 * 60;

/**
 * Holds a PDF password for the life of one queued job, and no longer.
 *
 * A synchronous render keeps the password in memory and is done with it. An
 * async render cannot: the job payload goes to Redis, where a plaintext
 * password would sit in a queue anyone with Redis access can read, and would
 * survive in a completed-job record long after the render finished.
 *
 * PLAN §3 offers two answers — encrypt the payload field, or hold the secret
 * by reference. This does both: the value is encrypted with the service key
 * before it goes to Redis, it expires on its own, and the job carries only an
 * opaque id. Taking it is a single atomic GETDEL, so a replayed job cannot
 * read the password a second time.
 */
@Injectable()
export class SecretsVault {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly crypto: CryptoService,
  ) {}

  private key(id: string): string {
    return `secret:${id}`;
  }

  /** Returns the reference to put in the job payload, or null if there is nothing to hide. */
  async store(protection: ProtectionDto | undefined): Promise<string | null> {
    if (!protection) return null;

    const id = randomUUID();

    await this.redis.set(
      this.key(id),
      this.crypto.encrypt(JSON.stringify(protection)),
      'EX',
      TTL_SECONDS,
    );

    return id;
  }

  /**
   * Reads and destroys in one operation. A job that is retried after its
   * secret was taken gets null rather than a second chance at the password —
   * the retry fails loudly instead of silently producing an unprotected PDF.
   */
  async take(id: string | null | undefined): Promise<ProtectionDto | null> {
    if (!id) return null;

    const payload = await this.redis.getdel(this.key(id));
    if (!payload) return null;

    return JSON.parse(this.crypto.decrypt(payload)) as ProtectionDto;
  }

  /** Drops a secret whose job was never queued, rather than waiting out the TTL. */
  async discard(id: string | null | undefined): Promise<void> {
    if (id) await this.redis.del(this.key(id));
  }
}
