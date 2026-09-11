import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { PdfModule } from '../pdf/pdf.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { AsyncRenderController } from './async-render.controller.js';
import { JobsController } from './jobs.controller.js';
import { RenderQueue } from './render.queue.js';
import { RenderWorker } from './render.worker.js';
import { SecretsVault } from './secrets.vault.js';

@Module({
  imports: [PdfModule, DocumentsModule, WebhooksModule],
  controllers: [AsyncRenderController, JobsController],
  providers: [RenderQueue, RenderWorker, SecretsVault],
  exports: [RenderQueue, SecretsVault],
})
export class QueueModule {}
