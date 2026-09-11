import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGuard } from './auth.guard.js';
import { ProblemError } from '../common/errors/problem.js';
import { RequireScopes } from '../tokens/scopes.js';
import type { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { TokensService } from '../tokens/tokens.service.js';
import type { AccessTokenClaims } from './auth.service.js';
import type { RequestContext } from './request-context.js';
import type { Scope } from '../tokens/scopes.js';

const API_TOKEN = 'pdfly_live_abcd1234_secret';

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
  let required: Scope[] | undefined;
  let claims: AccessTokenClaims | Error;
  let authenticate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    isPublic = false;
    required = undefined;
    claims = { sub: 'user-1', orgId: 'org-1', scopes: ['pdf:render'] };
    authenticate = vi.fn().mockResolvedValue({
      orgId: 'org-2',
      tokenId: 'token-1',
      scopes: ['pdf:render'],
    } satisfies RequestContext);

    const reflector = {
      // The guard reads two different metadata keys off the same handler.
      getAllAndOverride: (key: string) => (key === 'auth:public' ? isPublic : required),
    } as unknown as Reflector;

    const jwt = {
      verifyAsync: () =>
        claims instanceof Error ? Promise.reject(claims) : Promise.resolve(claims),
    } as unknown as JwtService;

    const tokens = { authenticate } as unknown as TokensService;

    guard = new AuthGuard(reflector, jwt, tokens);
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
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('rejects an access token the signer will not verify', async () => {
    claims = new Error('jwt expired');

    await expect(
      guard.canActivate(contextFor({ headers: { authorization: 'Bearer a.b.c' } })),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
  });

  it('hands anything that is not a JWT to the token service', async () => {
    const request: FakeRequest = { headers: { authorization: `Bearer ${API_TOKEN}` } };

    await guard.canActivate(contextFor(request));

    expect(authenticate).toHaveBeenCalledWith(API_TOKEN);
    expect(request.ctx).toMatchObject({ orgId: 'org-2', tokenId: 'token-1' });
    // An API token has no person behind it.
    expect(request.ctx?.userId).toBeUndefined();
  });

  it('accepts a token from x-api-key as well as Authorization', async () => {
    await guard.canActivate(contextFor({ headers: { 'x-api-key': API_TOKEN } }));

    expect(authenticate).toHaveBeenCalledWith(API_TOKEN);
  });

  it('lets the token service decide what an invalid token means', async () => {
    authenticate.mockRejectedValue(new ProblemError('unauthorized', 401, 'API token is invalid'));

    await expect(
      guard.canActivate(contextFor({ headers: { 'x-api-key': API_TOKEN } })),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  describe('scopes', () => {
    it('allows a credential that carries the required scope', async () => {
      required = ['pdf:render'];

      await expect(
        guard.canActivate(contextFor({ headers: { authorization: 'Bearer a.b.c' } })),
      ).resolves.toBe(true);
    });

    it('refuses with 403, not 401: the credential is real but lacks authority', async () => {
      required = ['documents:delete'];

      await expect(
        guard.canActivate(contextFor({ headers: { authorization: 'Bearer a.b.c' } })),
      ).rejects.toMatchObject({
        code: 'forbidden',
        status: 403,
        detail: expect.stringContaining('documents:delete') as unknown,
      });
    });

    it('names every missing scope, not just the first', async () => {
      required = ['documents:read', 'documents:delete'];

      await expect(
        guard.canActivate(contextFor({ headers: { authorization: 'Bearer a.b.c' } })),
      ).rejects.toMatchObject({
        detail: expect.stringContaining('documents:read, documents:delete') as unknown,
      });
    });

    it('applies to API tokens the same way', async () => {
      required = ['documents:delete'];

      await expect(
        guard.canActivate(contextFor({ headers: { 'x-api-key': API_TOKEN } })),
      ).rejects.toMatchObject({ code: 'forbidden' });
    });
  });
});

describe('RequireScopes', () => {
  it('is a metadata decorator, so the guard is the only enforcement point', () => {
    const decorator = RequireScopes('pdf:render');

    expect(typeof decorator).toBe('function');
  });
});
