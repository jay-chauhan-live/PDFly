import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ProblemError } from '../common/errors/problem.js';
import { TokensService } from '../tokens/tokens.service.js';
import { REQUIRED_SCOPES, type Scope } from '../tokens/scopes.js';
import { IS_PUBLIC } from './public.decorator.js';
import type { AccessTokenClaims } from './auth.service.js';
import type { RequestContext } from './request-context.js';

/**
 * The single place where a credential becomes a request context (PLAN §5).
 *
 * Two credential types, one outcome: a dashboard access JWT or an API token.
 * Everything downstream reads `request.ctx` and cannot tell which was used —
 * except where it genuinely matters, like attributing a render to a person.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly tokens: TokensService,
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

    // A JWT has three dot-separated segments; anything else is an API token.
    const ctx =
      presented.split('.').length === 3
        ? await this.fromAccessToken(presented)
        : await this.tokens.authenticate(presented);

    this.assertScopes(context, ctx);
    request.ctx = ctx;

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

  /**
   * 403, not 401: the credential is genuine and re-authenticating would not
   * help. What is missing is authority, and the response says which.
   */
  private assertScopes(context: ExecutionContext, ctx: RequestContext): void {
    const required = this.reflector.getAllAndOverride<Scope[]>(REQUIRED_SCOPES, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length) return;

    const missing = required.filter((scope) => !ctx.scopes.includes(scope));

    if (missing.length > 0) {
      throw new ProblemError(
        'forbidden',
        403,
        `This credential is missing the ${missing.join(', ')} scope${missing.length > 1 ? 's' : ''}`,
        { requiredScopes: required },
      );
    }
  }
}
