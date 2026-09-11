import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ProblemError } from '../common/errors/problem.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PasswordService } from './password.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import type { Env } from '../config/env.schema.js';
import type { LoginDto, RegisterDto } from './dto/auth.dto.js';

export interface AuthenticatedUser {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: string;
  themePref: string;
  emailVerified: boolean;
  org: { id: string; name: string; slug: string; plan: string };
}

export interface AuthResult {
  accessToken: string;
  /** Absent when the caller must keep the refresh cookie it already has. */
  refreshToken?: string;
  user: AuthenticatedUser;
}

export interface AccessTokenClaims {
  sub: string;
  orgId: string;
  scopes: string[];
}

/** Dashboard sessions carry full scope; API tokens are scoped per token (PLAN §5). */
const SESSION_SCOPES = ['pdf:render', 'documents:read', 'documents:delete'];

/**
 * One shape for the signed-in user, so login, registration, refresh and
 * `GET /auth/me` cannot drift apart and leave the dashboard guessing which
 * fields it actually has.
 */
const USER_SELECT = {
  id: true,
  orgId: true,
  email: true,
  name: true,
  role: true,
  themePref: true,
  emailVerifiedAt: true,
  org: { select: { id: true, name: true, slug: true, plan: true } },
} as const;

type UserRow = {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: string;
  themePref: string;
  emailVerifiedAt: Date | null;
  org: { id: string; name: string; slug: string; plan: string };
};

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'org'
  );
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.accessTtlSeconds = config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
  }

  async register(dto: RegisterDto): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });

    if (existing) {
      throw new ProblemError('invalid_request', 409, 'An account with that email already exists');
    }

    const passwordHash = await this.passwords.hash(dto.password);

    // The organization and its first user are created together: a user without
    // an org has nothing to own, and an org without an owner is unreachable.
    const user = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: dto.organizationName?.trim() || dto.name.trim(),
          slug: await this.uniqueSlug(slugify(dto.organizationName ?? dto.name)),
        },
        select: { id: true },
      });

      return tx.user.create({
        data: {
          orgId: org.id,
          email,
          passwordHash,
          name: dto.name.trim(),
          // First user of an organization owns it.
          role: 'owner',
        },
        select: USER_SELECT,
      });
    });

    await this.prisma.auditLogEntry.create({
      data: { orgId: user.orgId, actorId: user.id, action: 'user.register', target: user.id },
    });

    this.logger.log(`registered organization ${user.orgId} with owner ${user.id}`);

    return this.issue(user);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { ...USER_SELECT, passwordHash: true },
    });

    // Verify against a dummy hash when the account is absent, so that a missing
    // account and a wrong password take the same amount of time.
    const valid = user
      ? await this.passwords.verify(user.passwordHash, dto.password)
      : await this.passwords.verify('$argon2id$v=19$m=19456,t=2,p=1$invalid$invalid', dto.password);

    if (!user || !valid) {
      throw new ProblemError('unauthorized', 401, 'Invalid email or password');
    }

    return this.issue(user);
  }

  /**
   * Exchanges a refresh token for a new pair. A superseded token revokes the
   * whole family (PLAN §5), which logs the user out everywhere — the correct
   * response to a token that may have leaked. The exception is a token
   * superseded moments ago, which is a race between two tabs rather than an
   * attack: that caller gets an access token and keeps its cookie.
   */
  async refresh(presented: string): Promise<AuthResult> {
    const result = await this.refreshTokens.rotate(presented);

    if (result.outcome === 'reused') {
      throw new ProblemError(
        'unauthorized',
        401,
        'This session was revoked because a refresh token was reused',
      );
    }

    if (result.outcome === 'unknown') {
      throw new ProblemError('unauthorized', 401, 'Session expired');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: result.family.userId },
      select: USER_SELECT,
    });

    if (!user) {
      await this.refreshTokens.revoke(presented);
      throw new ProblemError('unauthorized', 401, 'Session expired');
    }

    return {
      accessToken: await this.signAccessToken(user.id, user.orgId),
      ...(result.outcome === 'rotated' ? { refreshToken: result.issued.token } : {}),
      user: this.toAuthenticatedUser(user),
    };
  }

  async logout(presented: string | undefined): Promise<void> {
    if (presented) await this.refreshTokens.revoke(presented);
  }

  /** The same user shape the token-issuing routes return. */
  async describe(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });

    if (!user) throw new ProblemError('not_found', 404, 'User not found');

    return this.toAuthenticatedUser(user);
  }

  private async issue(user: UserRow): Promise<AuthResult> {
    const [accessToken, refresh] = await Promise.all([
      this.signAccessToken(user.id, user.orgId),
      this.refreshTokens.issue(user.id, user.orgId),
    ]);

    return {
      accessToken,
      refreshToken: refresh.token,
      user: this.toAuthenticatedUser(user),
    };
  }

  private signAccessToken(userId: string, orgId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, orgId, scopes: SESSION_SCOPES } satisfies AccessTokenClaims,
      { expiresIn: this.accessTtlSeconds },
    );
  }

  /**
   * Built field by field rather than by spreading the row: this object becomes
   * an HTTP response, and the login query also carries the password hash.
   */
  private toAuthenticatedUser(user: UserRow): AuthenticatedUser {
    return {
      id: user.id,
      orgId: user.orgId,
      email: user.email,
      name: user.name,
      role: user.role,
      themePref: user.themePref,
      emailVerified: user.emailVerifiedAt !== null,
      org: user.org,
    };
  }

  private async uniqueSlug(base: string): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const taken = await this.prisma.organization.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });

      if (!taken) return candidate;
    }

    return `${base}-${Date.now().toString(36)}`;
  }
}
