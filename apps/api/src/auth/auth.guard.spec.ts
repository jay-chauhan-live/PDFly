import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGuard } from './auth.guard.js';
import { ProblemError } from '../common/errors/problem.js';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AccessTokenClaims } from './auth.service.js';
import type { RequestContext } from './request-context.js';

const DEV_KEY = 'dev_local_key_change_me';
const DEV_ORG_ID = 'org-development';

interface FakeRequest {
  headers: Record<string, string | undefined>;
  ctx?: RequestContext;
}

function contextFor(request: FakeRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let isPublic: boolean;
  let claims: AccessTokenClaims | Error;
  let findUnique: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    isPublic = false;
    claims = { sub: 'user-1', orgId: 'org-1', scopes: ['pdf:render'] };
    findUnique = vi.fn().mockResolvedValue({ id: DEV_ORG_ID });

    const reflector = { getAllAndOverride: () => isPublic } as unknown as Reflector;
    const config = { get: () => DEV_KEY } as unknown as ConfigService<never, true>;
    const jwt = {
      verifyAsync: () =>
        claims instanceof Error ? Promise.reject(claims) : Promise.resolve(claims),
    } as unknown as JwtService;
    const prisma = { organization: { findUnique } } as unknown as PrismaService;

    guard = new AuthGuard(reflector, config, jwt, prisma);
  });

  it('lets a @Public() route through without a credential', async () => {
    isPublic = true;
    const request: FakeRequest = { headers: {} };

    expect(await guard.canActivate(contextFor(request))).toBe(true);
    // Nothing was resolved, so nothing downstream can mistake it for a session.
    expect(request.ctx).toBeUndefined();
  });

  it('rejects a request with no credential at all', async () => {
    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toThrow(ProblemError);
  });

  it('resolves a dashboard access token into a user context', async () => {
    const request: FakeRequest = { headers: { authorization: 'Bearer a.b.c' } };

    await guard.canActivate(contextFor(request));

    expect(request.ctx).toEqual({ orgId: 'org-1', userId: 'user-1', scopes: ['pdf:render'] });
  });

  it('rejects an access token the signer will not verify', async () => {
    claims = new Error('jwt expired');

    await expect(
      guard.canActivate(contextFor({ headers: { authorization: 'Bearer a.b.c' } })),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
  });

  it('resolves the development API key to the seeded org, with no user behind it', async () => {
    const request: FakeRequest = { headers: { authorization: `Bearer ${DEV_KEY}` } };

    await guard.canActivate(contextFor(request));

    expect(request.ctx?.orgId).toBe(DEV_ORG_ID);
    expect(request.ctx?.userId).toBeUndefined();
  });

  it('accepts the API key from x-api-key as well as Authorization', async () => {
    const request: FakeRequest = { headers: { 'x-api-key': DEV_KEY } };

    await guard.canActivate(contextFor(request));

    expect(request.ctx?.orgId).toBe(DEV_ORG_ID);
  });

  it('rejects a wrong API key, including one that only shares a prefix', async () => {
    await expect(
      guard.canActivate(contextFor({ headers: { 'x-api-key': 'dev_local_key_change_ME' } })),
    ).rejects.toMatchObject({ code: 'unauthorized' });

    await expect(
      guard.canActivate(contextFor({ headers: { 'x-api-key': 'dev_local' } })),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('looks the development org up once and caches it', async () => {
    await guard.canActivate(contextFor({ headers: { 'x-api-key': DEV_KEY } }));
    await guard.canActivate(contextFor({ headers: { 'x-api-key': DEV_KEY } }));

    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('says so plainly when the development org was never seeded', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(contextFor({ headers: { 'x-api-key': DEV_KEY } })),
    ).rejects.toThrow(/db:seed/);
  });
});
