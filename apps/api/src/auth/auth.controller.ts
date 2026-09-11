import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { ProblemError } from '../common/errors/problem.js';
import { AuthService, type AuthenticatedUser, type AuthResult } from './auth.service.js';
import { CurrentContext } from './current-context.decorator.js';
import { LoginDto, RegisterDto } from './dto/auth.dto.js';
import { Public } from './public.decorator.js';
import { RateLimit } from '../ratelimit/rate-limit.guard.js';
import type { Env } from '../config/env.schema.js';
import type { RequestContext } from './request-context.js';

export const REFRESH_COOKIE = 'pdfly_refresh';

@Controller('auth')
export class AuthController {
  private readonly cookieOptions: CookieOptions;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService<Env, true>,
  ) {
    const isDev = config.get('NODE_ENV', { infer: true }) === 'development';

    this.cookieOptions = {
      httpOnly: true,
      // PLAN §5 calls for Secure. Kept off in development only, because the
      // local dashboard is served over plain http.
      secure: !isDev,
      sameSite: 'lax',
      // Scoped to the auth routes: no other endpoint has any use for it.
      path: '/v1/auth',
      maxAge: config.get('REFRESH_TTL_DAYS', { infer: true }) * 24 * 60 * 60 * 1000,
    };
  }

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res() response: Response): Promise<void> {
    this.send(response, 201, await this.auth.register(dto));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res() response: Response): Promise<void> {
    this.send(response, 200, await this.auth.login(dto));
  }

  @Public()
  // Every page load and every open tab refreshes; this is not a login attempt
  // and must not share the budget that exists to slow password guessing.
  @RateLimit({ limit: 60, bucket: 'refresh' })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() request: Request, @Res() response: Response): Promise<void> {
    const presented = request.cookies?.[REFRESH_COOKIE] as string | undefined;

    if (!presented) {
      throw new ProblemError('unauthorized', 401, 'No session cookie');
    }

    try {
      this.send(response, 200, await this.auth.refresh(presented));
    } catch (error) {
      // The cookie is worthless now; clear it so the browser stops sending it.
      response.clearCookie(REFRESH_COOKIE, this.cookieOptions);
      throw error;
    }
  }

  @Public()
  @RateLimit({ limit: 60, bucket: 'refresh' })
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.auth.logout(request.cookies?.[REFRESH_COOKIE] as string | undefined);
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions);
    response.status(204).send();
  }

  @Get('me')
  async me(@CurrentContext() ctx: RequestContext): Promise<AuthenticatedUser> {
    if (!ctx.userId) {
      // An API token is a valid credential but has no person behind it.
      throw new ProblemError('unauthorized', 401, 'This endpoint requires a user session');
    }

    return this.auth.describe(ctx.userId);
  }

  private send(response: Response, status: number, result: AuthResult): void {
    // A concurrent refresh returns no token: another tab has already replaced
    // the shared cookie, and overwriting it here would undo that.
    if (result.refreshToken) {
      response.cookie(REFRESH_COOKIE, result.refreshToken, this.cookieOptions);
    }

    response
      .status(status)
      // The refresh token goes in the cookie and nowhere else — never in a
      // response body where script could read it.
      .json({ accessToken: result.accessToken, user: result.user });
  }
}
