import { Global, Module } from '@nestjs/common';
import { WebhookService } from './webhook.service.js';

@Global()
@Module({
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhooksModule {}
