import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { ProblemExceptionFilter } from './common/errors/problem.filter.js';
import type { Env } from './config/env.schema.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  // PLAN §6 caps markup at 5 MB; the body parser must agree or express
  // rejects oversized payloads before the api can return its own 413.
  app.useBodyParser('json', { limit: '6mb' });

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.use(helmet());
  // The refresh token travels as an httpOnly cookie (PLAN §5).
  app.use(cookieParser());

  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.enableCors({
    origin: config.get('WEB_URL', { infer: true }),
    credentials: true,
    // Without this the dashboard can see the body of a render response but
    // not the metadata the api attaches alongside it.
    exposedHeaders: ['x-document-id', 'x-page-count', 'x-duration-ms'],
  });

  // Every error leaves as RFC 7807 problem+json with a stable code (PLAN §6).
  app.useGlobalFilters(new ProblemExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Reject unknown keys outright: a typo'd render option should be an
      // error, not a silently ignored field that produces the wrong PDF.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Versioned from day one (docs/PLAN.md §6). /health sits outside the prefix.
  app.setGlobalPrefix('v1', { exclude: ['health', 'health/live'] });

  const port = config.get('API_PORT', { infer: true });
  await app.listen(port);

  app.get(Logger).log(`api listening on ${config.get('API_URL', { infer: true })}`);
}

void bootstrap();
