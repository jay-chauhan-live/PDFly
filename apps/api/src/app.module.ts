import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { buildLoggerOptions } from './common/logger.options.js';
import { validateEnv, type Env } from './config/env.schema.js';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard.js';
import { RateLimitGuard } from './ratelimit/rate-limit.guard.js';
import { RateLimitModule } from './ratelimit/rate-limit.module.js';
import { UsageModule } from './usage/usage.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { TokensModule } from './tokens/tokens.module.js';
import { HealthModule } from './health/health.module.js';
import { PdfModule } from './pdf/pdf.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { RendererModule } from './renderer/renderer.module.js';
import { StorageModule } from './storage/storage.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      // The repo root .env is the single source of truth in development, so
      // api and web cannot drift apart on ports or credentials.
      envFilePath: ['../../.env'],
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        buildLoggerOptions({
          NODE_ENV: config.get('NODE_ENV', { infer: true }),
          LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }),
        } as Env),
    }),
    // Drives the usage flush (PLAN §8).
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    RateLimitModule,
    UsageModule,
    TokensModule,
    AuthModule,
    StorageModule,
    RendererModule,
    HealthModule,
    PdfModule,
    DocumentsModule,
  ],
  // Authentication is on by default; routes opt out with @Public() (PLAN §5).
  // Order matters: APP_GUARD providers run in declaration order, and the rate
  // limiter needs request.ctx to bill the right credential.
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
