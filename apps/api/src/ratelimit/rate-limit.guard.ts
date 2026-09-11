import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ProblemError } from '../common/errors/problem.js';
import { RateLimitService } from './rate-limit.service.js';
import type { Request, Response } from 'express';
import type { Env } from '../config/env.schema.js';

export const RATE_LIMIT = 'ratelimit:options';
export const SKIP_RATE_LIMIT = 'ratelimit:skip';

export interface RateLimitOptions {
  /** Requests per window. */
  limit: number;
  windowMs?: number;
  /** Distinguishes this route's budget from the shared one. */
  bucket?: string;
}

/** Overrides the default budget for one route or controller. */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT, options);

/**
 * Exempts a route entirely. For liveness and readiness probes, which are
 * polled on a fixed schedule by infrastructure that has no credential and no
 * way to back off — rate limiting those turns a busy minute into a restart.
 */
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT, true);

/**
 * Rate limiting, applied after authentication (PLAN §6).
 *
 * Authenticated callers are limited per credential, so one noisy token cannot
 * spend another's budget and a shared office IP is not punished collectively.
 * Unauthenticated routes — sign-in, registration — fall back to the client
 * address, which is the only identity available and the one that matters for
 * password guessing.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly defaultLimit: number;
  private readonly authLimit: number;

  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
    config: ConfigService<Env, true>,
  ) {
    this.defaultLimit = config.get('RATE_LIMIT_PER_MINUTE', { infer: true });
    this.authLimit = config.get('AUTH_RATE_LIMIT_PER_MINUTE', { infer: true });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skip) return true;

    const override = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);

    const identity = this.identify(request);
    const limit = override?.limit ?? (identity.authenticated ? this.defaultLimit : this.authLimit);
    const bucket = override?.bucket ? `${override.bucket}:` : '';

    const verdict = await this.limiter.consume(
      `${bucket}${identity.subject}`,
      limit,
      override?.windowMs,
    );

    // Headers on every response, not only refusals: a client that can see its
    // remaining budget can pace itself instead of discovering the limit by
    // hitting it (PLAN §6).
    response.setHeader('X-RateLimit-Limit', verdict.limit);
    response.setHeader('X-RateLimit-Remaining', verdict.remaining);
    response.setHeader('X-RateLimit-Reset', verdict.resetAt);

    if (!verdict.allowed) {
      response.setHeader('Retry-After', verdict.retryAfter);
      throw new ProblemError('rate_limited', 429, 'Too many requests; slow down', {
        retryAfter: verdict.retryAfter,
      });
    }

    return true;
  }

  private identify(request: Request): { subject: string; authenticated: boolean } {
    const ctx = request.ctx;

    // Per token, then per user, then per address. An org-wide bucket would let
    // one runaway script starve every other integration the org runs.
    if (ctx?.tokenId) return { subject: `token:${ctx.tokenId}`, authenticated: true };
    if (ctx?.userId) return { subject: `user:${ctx.userId}`, authenticated: true };

    return { subject: `ip:${request.ip ?? 'unknown'}`, authenticated: false };
  }
}
