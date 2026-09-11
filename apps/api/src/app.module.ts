import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { buildLoggerOptions } from './common/logger.options.js';
import { validateEnv, type Env } from './config/env.schema.js';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
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
    PrismaModule,
    RedisModule,
    AuthModule,
    StorageModule,
    RendererModule,
    HealthModule,
    PdfModule,
  ],
  // Authentication is on by default; routes opt out with @Public() (PLAN §5).
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
