import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { Redis } from 'ioredis';
import type { Env } from '../config/env.schema.js';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Redis =>
        new Redis(config.get('REDIS_URL', { infer: true }), {
          // BullMQ requires this; setting it here keeps every client uniform.
          maxRetriesPerRequest: null,
          lazyConnect: false,
        }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(private readonly moduleRef: ModuleRef) {}

  async onApplicationShutdown(): Promise<void> {
    const client = this.moduleRef.get<Redis>(REDIS_CLIENT, { strict: false });
    await client.quit();
  }
}
