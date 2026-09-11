import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  type HealthCheckResult,
  type HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import type { Redis } from 'ioredis';
import { Public } from '../auth/public.decorator.js';
import { SkipRateLimit } from '../ratelimit/rate-limit.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { EncryptionService } from '../protection/encryption.service.js';
import { RendererClient } from '../renderer/renderer.client.js';

/**
 * Unauthenticated on purpose: a load balancer, a container runtime and
 * `docker compose` health checks have no credential to present, and the
 * response reveals nothing beyond whether dependencies answer.
 */
@Public()
@SkipRateLimit()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly renderer: RendererClient,
    private readonly encryption: EncryptionService,
  ) {}

  /** Liveness: is the process up? Deliberately checks no dependencies. */
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  /** Readiness: can we actually serve traffic? */
  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.checkPostgres(),
      () => this.checkRedis(),
      () => this.checkRenderer(),
      () => this.checkQpdf(),
    ]);
  }

  private async checkPostgres(): Promise<HealthIndicatorResult> {
    const check = this.indicator.check('postgres');
    try {
      await this.prisma.ping();
      return check.up();
    } catch (error) {
      return check.down({ message: (error as Error).message });
    }
  }

  /**
   * qpdf is an external binary, so its absence is a deployment fault rather
   * than a code one — and it only shows up when someone asks for a password,
   * long after the container started. Surfacing it here makes it a startup
   * problem instead of a customer's problem.
   */
  private async checkQpdf(): Promise<HealthIndicatorResult> {
    const check = this.indicator.check('qpdf');
    return (await this.encryption.isAvailable())
      ? check.up()
      : check.down({ message: 'qpdf is not on PATH; password protection will fail' });
  }

  private async checkRenderer(): Promise<HealthIndicatorResult> {
    const check = this.indicator.check('renderer');
    return (await this.renderer.healthy()) ? check.up() : check.down();
  }

  private async checkRedis(): Promise<HealthIndicatorResult> {
    const check = this.indicator.check('redis');
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG' ? check.up() : check.down({ message: `unexpected reply: ${pong}` });
    } catch (error) {
      return check.down({ message: (error as Error).message });
    }
  }
}
