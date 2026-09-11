import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProblemError } from '../common/errors/problem.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import {
  hashToken,
  maskedToken,
  mintToken,
  parseTokenPrefix,
  tokensMatch,
} from './token.format.js';
import type { Redis } from 'ioredis';
import type { RequestContext } from '../auth/request-context.js';
import type { Scope } from './scopes.js';
import type { CreateTokenDto } from './dto/token.dto.js';

/**
 * `last_used_at` is useful for spotting a token nobody uses any more. It is
 * not an audit trail, so it does not need to be exact — and writing to
 * Postgres on every authenticated request to keep it exact would be a real
 * cost for no real benefit (PLAN §5). One write per token per minute.
 */
const LAST_USED_THROTTLE_SECONDS = 60;

export interface TokenSummary {
  id: string;
  name: string;
  prefix: string;
  masked: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  creator: { id: string; name: string; email: string } | null;
}

const SUMMARY_SELECT = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  creator: { select: { id: true, name: true, email: true } },
} as const;

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Resolves a presented API token into a request context, or throws.
   *
   * Lookup is by the indexed prefix and the comparison is constant-time over
   * the digests, so neither the query plan nor the response time distinguishes
   * a wrong secret from an unknown one.
   */
  async authenticate(presented: string): Promise<RequestContext> {
    const prefix = parseTokenPrefix(presented);

    if (!prefix) throw new ProblemError('unauthorized', 401, 'API token is invalid');

    const token = await this.prisma.apiToken.findUnique({
      where: { prefix },
      select: {
        id: true,
        orgId: true,
        tokenHash: true,
        scopes: true,
        expiresAt: true,
        revokedAt: true,
      },
    });

    if (!token || !tokensMatch(hashToken(presented), token.tokenHash)) {
      throw new ProblemError('unauthorized', 401, 'API token is invalid');
    }

    if (token.revokedAt) {
      throw new ProblemError('unauthorized', 401, 'This API token has been revoked');
    }

    if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) {
      throw new ProblemError('unauthorized', 401, 'This API token has expired');
    }

    void this.touch(token.id);

    return { orgId: token.orgId, tokenId: token.id, scopes: token.scopes };
  }

  async create(
    orgId: string,
    dto: CreateTokenDto,
    createdBy?: string,
  ): Promise<TokenSummary & { token: string }> {
    const minted = mintToken();

    const record = await this.prisma.apiToken.create({
      data: {
        orgId,
        name: dto.name.trim(),
        prefix: minted.prefix,
        tokenHash: minted.hash,
        scopes: dto.scopes,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdBy: createdBy ?? null,
      },
      select: SUMMARY_SELECT,
    });

    await this.prisma.auditLogEntry.create({
      data: {
        orgId,
        actorId: createdBy ?? null,
        action: 'token.create',
        target: record.id,
        metadataJson: { name: record.name, scopes: record.scopes },
      },
    });

    this.logger.log(`minted token ${record.id} (${minted.prefix}) for org ${orgId}`);

    // The only time the caller ever sees the secret (PLAN §5). There is no
    // recovery path by design: a token you cannot read is one nobody else can
    // read either, and regenerating is cheap.
    return { ...this.toSummary(record), token: minted.token };
  }

  async list(orgId: string): Promise<TokenSummary[]> {
    const tokens = await this.prisma.apiToken.findMany({
      where: { orgId },
      select: SUMMARY_SELECT,
      orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
    });

    return tokens.map((token) => this.toSummary(token));
  }

  /**
   * Revocation is a tombstone, not a delete: the audit log references the
   * token id, and "this token was revoked on Tuesday" is the answer someone
   * will eventually need. Revoking twice is not an error.
   */
  async revoke(orgId: string, id: string, actorId?: string): Promise<TokenSummary> {
    const existing = await this.prisma.apiToken.findFirst({
      where: { id, orgId },
      select: { id: true, revokedAt: true },
    });

    if (!existing) throw new ProblemError('not_found', 404, 'No such API token');

    if (existing.revokedAt) {
      const unchanged = await this.prisma.apiToken.findUniqueOrThrow({
        where: { id },
        select: SUMMARY_SELECT,
      });
      return this.toSummary(unchanged);
    }

    const revoked = await this.prisma.apiToken.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: SUMMARY_SELECT,
    });

    await this.prisma.auditLogEntry.create({
      data: { orgId, actorId: actorId ?? null, action: 'token.revoke', target: id },
    });

    this.logger.log(`revoked token ${id}`);

    return this.toSummary(revoked);
  }

  /** Best-effort and throttled; a failure here must never fail the request. */
  private async touch(id: string): Promise<void> {
    try {
      const first = await this.redis.set(
        `token:touched:${id}`,
        '1',
        'EX',
        LAST_USED_THROTTLE_SECONDS,
        'NX',
      );

      if (first !== 'OK') return;

      await this.prisma.apiToken.update({ where: { id }, data: { lastUsedAt: new Date() } });
    } catch (error) {
      this.logger.warn({ err: error }, `could not record last use of token ${id}`);
    }
  }

  private toSummary(token: Omit<TokenSummary, 'masked' | 'scopes'> & { scopes: string[] }) {
    return { ...token, scopes: token.scopes as Scope[], masked: maskedToken(token.prefix) };
  }
}
