import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service.js';
import { UsageController } from './usage.controller.js';
import { UsageService } from './usage.service.js';

@Global()
@Module({
  controllers: [UsageController],
  providers: [UsageService, IdempotencyService],
  exports: [UsageService, IdempotencyService],
})
export class UsageModule {}
