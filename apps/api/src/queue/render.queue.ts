import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import type { Redis } from 'ioredis';
import type { RenderPdfDto } from '../pdf/dto/render-pdf.dto.js';

/**
 * PLAN §8 asks for separate queues so a batch job cannot starve interactive
 * renders. Synchronous renders never enter a queue at all — they run inline
 * on the request — so there is exactly one queue today, and naming it for
 * what it carries leaves room for the second without a migration.
 */
// A colon would be rejected: BullMQ uses it as its own Redis key separator.
export const ASYNC_RENDER_QUEUE = 'render-async';

/** What travels to Redis. Notably absent: anything secret. */
export interface RenderJobPayload {
  documentId: string;
  orgId: string;
  userId?: string;
  /** The request, with `protection` removed (PLAN §3). */
  request: Omit<RenderPdfDto, 'protection'>;
  /** Opaque handle to the passwords held in the vault, if there were any. */
  secretId: string | null;
  webhookUrl?: string;
}

@Injectable()
export class RenderQueue implements OnApplicationShutdown {
  private readonly logger = new Logger(RenderQueue.name);
  private readonly queue: Queue<RenderJobPayload>;

  constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    this.queue = new Queue<RenderJobPayload>(ASYNC_RENDER_QUEUE, {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        // Keep a window of history for the jobs endpoint to answer from,
        // bounded so the queue cannot grow without limit.
        removeOnComplete: { age: 24 * 60 * 60, count: 5000 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
      },
    });
  }

  async enqueue(payload: RenderJobPayload): Promise<string> {
    // The document id is the job id: one document, one job, and a retried
    // enqueue cannot produce two renders of the same row.
    const job = await this.queue.add('render', payload, { jobId: payload.documentId });

    this.logger.log(`queued ${payload.documentId} for org ${payload.orgId}`);

    return job.id ?? payload.documentId;
  }

  async find(documentId: string) {
    return this.queue.getJob(documentId);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
