import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentContext } from '../auth/current-context.decorator.js';
import { DocumentsService } from '../documents/documents.service.js';
import { attributionFor } from '../pdf/attribution.js';
import { RenderPdfDto } from '../pdf/dto/render-pdf.dto.js';
import { RenderPipeline } from '../pdf/render.pipeline.js';
import { RequireScopes } from '../tokens/scopes.js';
import { assertDeliverableUrl } from '../webhooks/webhook.url.js';
import { RenderQueue } from './render.queue.js';
import { SecretsVault } from './secrets.vault.js';
import type { RequestContext } from '../auth/request-context.js';
import type { Env } from '../config/env.schema.js';

/**
 * The async half of `/v1/pdf`, owned by the queue rather than by the
 * synchronous controller.
 *
 * Keeping it here is what stops the dependency from pointing both ways: the
 * queue already needs the render pipeline, so having the pipeline's module
 * also need the queue would be a cycle. The route is the same to a caller.
 */
@Controller('pdf')
@RequireScopes('pdf:render')
export class AsyncRenderController {
  constructor(
    private readonly pipeline: RenderPipeline,
    private readonly documents: DocumentsService,
    private readonly queue: RenderQueue,
    private readonly vault: SecretsVault,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Enqueue and return immediately (PLAN §6).
   *
   * For documents too big to hold a connection open for, and for callers who
   * would rather not. The response carries the id the eventual document will
   * have, so a caller can poll `/v1/jobs/:id` or wait for the webhook.
   */
  @Post('async')
  @HttpCode(202)
  async renderAsync(@Body() dto: RenderPdfDto, @CurrentContext() ctx: RequestContext) {
    if (dto.webhookUrl) {
      assertDeliverableUrl(dto.webhookUrl, {
        allowPrivate: this.config.get('WEBHOOK_ALLOW_PRIVATE', { infer: true }),
      });
    }

    const by = attributionFor(ctx);
    const documentId = await this.pipeline.reserve(dto, by);

    // The passwords go to the vault, not into the job payload (PLAN §3, §8).
    const { protection: _protection, ...request } = dto;
    const secretId = await this.vault.store(dto.protection);

    try {
      await this.queue.enqueue({
        documentId,
        orgId: by.orgId,
        ...(by.userId ? { userId: by.userId } : {}),
        request,
        secretId,
        ...(dto.webhookUrl ? { webhookUrl: dto.webhookUrl } : {}),
      });
    } catch (error) {
      // Nothing is going to consume that secret now.
      await this.vault.discard(secretId);
      throw error;
    }

    await this.documents.recordJob(documentId, by.orgId, dto.webhookUrl);

    return {
      id: documentId,
      status: 'queued',
      statusUrl: `/v1/jobs/${documentId}`,
      ...(dto.webhookUrl ? { webhookUrl: dto.webhookUrl } : {}),
    };
  }
}
