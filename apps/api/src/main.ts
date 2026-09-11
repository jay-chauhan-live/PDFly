import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.schema.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.use(helmet());

  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.enableCors({ origin: config.get('WEB_URL', { infer: true }), credentials: true });

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
