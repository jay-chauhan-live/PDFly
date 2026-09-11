import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { ProblemError } from '../common/errors/problem.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Env } from '../config/env.schema.js';
import type { RequestContext } from './request-context.js';

const DEV_ORG_SLUG = 'development';

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Phase 1 stand-in for real authentication. A single static key resolves to
 * the seeded development organization. Phase 4 replaces this with hashed,
 * scoped API tokens; the guard is the only thing that should need changing,
 * because everything downstream reads `request.ctx`.
 */
@Injectable()
export class DevKeyGuard implements CanActivate {
  private cachedOrgId: string | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const presented = this.extractKey(request);
    const expected = this.config.get('DEV_API_KEY', { infer: true });

    if (!presented || !safeEqual(presented, expected)) {
      throw new ProblemError('unauthorized', 401, 'A valid API key is required');
    }

    request.ctx = {
      orgId: await this.resolveOrgId(),
      scopes: ['pdf:render', 'documents:read', 'documents:delete'],
    } satisfies RequestContext;

    return true;
  }

  private extractKey(request: Request): string | undefined {
    const header = request.headers.authorization;

    if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);

    const apiKey = request.headers['x-api-key'];
    return typeof apiKey === 'string' ? apiKey : undefined;
  }

  private async resolveOrgId(): Promise<string> {
    if (this.cachedOrgId) return this.cachedOrgId;

    const org = await this.prisma.organization.findUnique({
      where: { slug: DEV_ORG_SLUG },
      select: { id: true },
    });

    if (!org) {
      throw new ProblemError(
        'internal_error',
        500,
        'Development organization is missing — run `pnpm db:seed`',
      );
    }

    this.cachedOrgId = org.id;
    return org.id;
  }
}
