import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { ProblemError } from '../common/errors/problem.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { IS_PUBLIC } from './public.decorator.js';
import type { Env } from '../config/env.schema.js';
import type { AccessTokenClaims } from './auth.service.js';
import type { RequestContext } from './request-context.js';

const DEV_ORG_SLUG = 'development';

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The single place where a credential becomes a request context (PLAN §5).
 *
 * Two credential types, one outcome: a dashboard access JWT or — until Phase 4
 * replaces it — the static development API key. Everything downstream reads
 * `request.ctx` and cannot tell which was used.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private cachedDevOrgId: string | null = null;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<Env, true>,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const presented = this.extractCredential(request);

    if (!presented) {
      throw new ProblemError('unauthorized', 401, 'Authentication is required');
    }

    // A JWT has three dot-separated segments; anything else is an API key.
    request.ctx =
      presented.split('.').length === 3
        ? await this.fromAccessToken(presented)
        : await this.fromApiKey(presented);

    return true;
  }

  private extractCredential(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();

    const apiKey = request.headers['x-api-key'];
    return typeof apiKey === 'string' ? apiKey : undefined;
  }

  private async fromAccessToken(token: string): Promise<RequestContext> {
    let claims: AccessTokenClaims;

    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token);
    } catch {
      throw new ProblemError('unauthorized', 401, 'Access token is invalid or expired');
    }

    return { orgId: claims.orgId, userId: claims.sub, scopes: claims.scopes };
  }

  private async fromApiKey(key: string): Promise<RequestContext> {
    const expected = this.config.get('DEV_API_KEY', { infer: true });

    if (!safeEqual(key, expected)) {
      throw new ProblemError('unauthorized', 401, 'API key is invalid');
    }

    return {
      orgId: await this.resolveDevOrgId(),
      scopes: ['pdf:render', 'documents:read', 'documents:delete'],
    };
  }

  private async resolveDevOrgId(): Promise<string> {
    if (this.cachedDevOrgId) return this.cachedDevOrgId;

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

    this.cachedDevOrgId = org.id;
    return org.id;
  }
}
