import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import { RenderPipeline } from '../pdf/render.pipeline.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { MailerService } from '../smtp/mailer.service.js';
import { WebhookService } from '../webhooks/webhook.service.js';
import { ASYNC_RENDER_QUEUE, type RenderJobPayload } from './render.queue.js';
import { SecretsVault } from './secrets.vault.js';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env.schema.js';

/**
 * Consumes the async render queue.
 *
 * PLAN §2 describes `worker` as its own deployable. It runs in the api
 * process for now, which is a deliberate and reversible choice: the isolation
 * that actually matters for security is the renderer's — that is the process
 * executing attacker-supplied markup, and it is already separate with no
 * database credentials. Separating the worker buys independent scaling and
 * crash isolation, which are operational wins worth having but not worth
 * blocking async rendering on. Nothing here touches HTTP, so lifting this
 * class into `apps/worker` later is a move, not a rewrite.
 */
@Injectable()
export class RenderWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RenderWorker.name);
  private worker?: Worker<RenderJobPayload>;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly pipeline: RenderPipeline,
    private readonly vault: SecretsVault,
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    const concurrency = this.config.get('QUEUE_CONCURRENCY', { infer: true });

    if (concurrency <= 0) {
      this.logger.log('queue worker disabled (QUEUE_CONCURRENCY=0)');
      return;
    }

    this.worker = new Worker<RenderJobPayload>(ASYNC_RENDER_QUEUE, (job) => this.process(job), {
      connection: this.redis,
      concurrency,
      // Chromium is the bottleneck; a render that has gone this long is
      // stuck, and the lock should not outlive the pool's own timeout.
      lockDuration: 120_000,
    });

    this.worker.on('failed', (job, error) => {
      this.logger.error(`job ${job?.id ?? 'unknown'} failed: ${error.message}`);
    });

    this.logger.log(`queue worker listening with concurrency ${concurrency}`);
  }

  private async process(job: Job<RenderJobPayload>): Promise<void> {
    const { documentId, orgId, userId, request, secretId, webhookUrl } = job.data;

    // Taken, not read: a retry after the secret was consumed fails loudly
    // rather than quietly producing an unprotected PDF.
    const protection = await this.vault.take(secretId);

    if (secretId && !protection) {
      throw new Error('The protection secret for this job has expired');
    }

    await this.prisma.job.updateMany({
      where: { documentId },
      data: { status: 'active', attempts: job.attemptsMade + 1 },
    });

    try {
      const result = await this.pipeline.run(
        { ...request, ...(protection ? { protection } : {}) },
        { orgId, ...(userId ? { userId } : {}), source: userId ? 'ui' : 'api' },
        documentId,
      );

      await this.prisma.job.updateMany({ where: { documentId }, data: { status: 'completed' } });

      if (webhookUrl) {
        await this.webhooks.deliver(webhookUrl, {
          event: 'document.completed',
          documentId,
          pageCount: result.pageCount,
          byteSize: result.byteSize,
          durationMs: result.durationMs,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Render failed';

      // Only the final attempt is terminal; earlier ones will be retried.
      const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

      if (final) {
        await this.prisma.job.updateMany({ where: { documentId }, data: { status: 'failed' } });

        // Nobody is holding a connection waiting for this, so an alert is the
        // only way an organization learns their integration is broken.
        const document = await this.prisma.document.findUnique({
          where: { id: documentId },
          select: { id: true, title: true, errorCode: true, errorMessage: true },
        });

        if (document) await this.mailer.renderFailed(orgId, document);

        if (webhookUrl) {
          await this.webhooks.deliver(webhookUrl, {
            event: 'document.failed',
            documentId,
            error: message,
          });
        }
      }

      throw error;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    // Lets an in-flight render finish rather than orphaning a document row.
    await this.worker?.close();
  }
}
