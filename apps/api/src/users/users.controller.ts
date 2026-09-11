import { Body, Controller, HttpCode, Patch, Post } from '@nestjs/common';
import { ProblemError } from '../common/errors/problem.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService, type AuthenticatedUser } from '../auth/auth.service.js';
import { CurrentContext } from '../auth/current-context.decorator.js';
import { PasswordService } from '../auth/password.service.js';
import { RefreshTokenService } from '../auth/refresh-token.service.js';
import { ChangePasswordDto, UpdateProfileDto } from '../auth/dto/auth.dto.js';
import type { RequestContext } from '../auth/request-context.js';

@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  @Patch('me')
  async updateProfile(
    @CurrentContext() ctx: RequestContext,
    @Body() dto: UpdateProfileDto,
  ): Promise<AuthenticatedUser> {
    const userId = this.requireUser(ctx);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        // Persisted so the theme follows the user across devices (PLAN §9).
        ...(dto.themePref !== undefined ? { themePref: dto.themePref } : {}),
      },
      select: { id: true },
    });

    // The same shape the auth routes return, so the dashboard never has to
    // reason about which fields a given response happens to carry.
    return this.auth.describe(userId);
  }

  @Post('me/password')
  @HttpCode(204)
  async changePassword(
    @CurrentContext() ctx: RequestContext,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    const userId = this.requireUser(ctx);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });

    if (!user || !(await this.passwords.verify(user.passwordHash, dto.currentPassword))) {
      throw new ProblemError('unauthorized', 401, 'Current password is incorrect');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.passwords.hash(dto.newPassword) },
    });

    // Every existing session dies with the old password, including any an
    // attacker may be holding.
    await this.refreshTokens.revokeAllForUser(userId);

    await this.prisma.auditLogEntry.create({
      data: { orgId: ctx.orgId, actorId: userId, action: 'user.password_changed', target: userId },
    });
  }

  private requireUser(ctx: RequestContext): string {
    if (!ctx.userId) {
      throw new ProblemError('unauthorized', 401, 'This endpoint requires a user session');
    }

    return ctx.userId;
  }
}
