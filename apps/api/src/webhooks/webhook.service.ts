import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Env } from '../config/env.schema.js';

/** Per-attempt, so one unresponsive endpoint cannot hold a worker slot open. */
const TIMEOUT_MS = 10_000;

/** Attempts in total, not retries after the first. */
const MAX_ATTEMPTS = 4;

export interface WebhookEvent {
  event: 'document.completed' | 'document.failed';
  documentId: string;
  pageCount?: number;
  byteSize?: number;
  durationMs?: number;
  error?: string;
}

/**
 * Signs and delivers webhooks (PLAN §6).
 *
 * The signature covers a timestamp as well as the body. Signing the body
 * alone lets anyone who ever saw one valid request replay it forever; with a
 * timestamp inside the signed material, a receiver that checks freshness can
 * reject a replay, and one that does not is no worse off.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('WEBHOOK_SIGNING_SECRET', { infer: true });
  }

  /** `v1=<hex>` over `<timestamp>.<body>`, so the scheme can be versioned. */
  sign(timestamp: number, body: string): string {
    return `v1=${createHmac('sha256', this.secret).update(`${timestamp}.${body}`).digest('hex')}`;
  }

  /** What a receiver would run. Exported so the contract is tested, not just described. */
  verify(timestamp: number, body: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(timestamp, body));
    const presented = Buffer.from(signature);

    if (expected.length !== presented.length) return false;

    return timingSafeEqual(expected, presented);
  }

  /**
   * Delivers with bounded exponential backoff.
   *
   * Failure is recorded and dropped rather than thrown: the render succeeded,
   * and a customer's unreachable endpoint must not turn a completed document
   * into a failed job.
   */
  async deliver(url: string, event: WebhookEvent): Promise<void> {
    const body = JSON.stringify(event);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const timestamp = Math.floor(Date.now() / 1000);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'PDFly-Webhook/1',
            'x-pdfly-event': event.event,
            'x-pdfly-timestamp': String(timestamp),
            'x-pdfly-signature': this.sign(timestamp, body),
            'x-pdfly-attempt': String(attempt),
          },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
          redirect: 'manual',
        });

        if (response.ok) {
          await this.record(event.documentId, 'delivered');
          this.logger.log(`delivered ${event.event} for ${event.documentId} to ${hostOf(url)}`);
          return;
        }

        // 4xx other than 429 is the receiver saying "never send this again".
        // Retrying a rejected payload is noise for them and work for us.
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          await this.record(event.documentId, 'disabled');
          this.logger.warn(
            `webhook for ${event.documentId} refused with ${response.status}; not retrying`,
          );
          return;
        }

        this.logger.warn(`webhook attempt ${attempt} got ${response.status}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(`webhook attempt ${attempt} failed: ${message}`);
      }

      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt));
      }
    }

    await this.record(event.documentId, 'failed');
    this.logger.error(`webhook for ${event.documentId} gave up after ${MAX_ATTEMPTS} attempts`);
  }

  private async record(
    documentId: string,
    status: 'delivered' | 'failed' | 'disabled',
  ): Promise<void> {
    await this.prisma.job
      .updateMany({ where: { documentId }, data: { webhookStatus: status } })
      .catch((error: unknown) => {
        this.logger.warn({ err: error }, 'could not record webhook status');
      });
  }
}

/** 1s, 4s, 9s — enough to ride out a restart without holding a slot for minutes. */
function backoffMs(attempt: number): number {
  return attempt * attempt * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Hostname only: a full webhook URL can carry a token in its path or query. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown';
  }
}
