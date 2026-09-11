import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PDFDocument } from 'pdf-lib';
import { ProblemError } from '../common/errors/problem.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RendererClient } from '../renderer/renderer.client.js';
import { StorageService } from '../storage/storage.service.js';
import type { Env } from '../config/env.schema.js';
import type { RenderPdfDto } from './dto/render-pdf.dto.js';

export interface RenderOutcome {
  documentId: string;
  pdf: Buffer;
  storageKey: string;
  pageCount: number;
  byteSize: number;
  durationMs: number;
  filename: string;
}

/**
 * Render → store → record, as one unit.
 *
 * Phase 1 calls this straight from the controller. When the BullMQ queue and
 * worker arrive (PLAN §2, Phase 6), the worker calls this same service — the
 * orchestration should not need rewriting to move behind a queue.
 *
 * Watermarking and encryption are steps 3 and 4 of PLAN §3 and slot in
 * between `render` and `store`, in that order, in Phase 5.
 */
@Injectable()
export class RenderPipeline {
  private readonly logger = new Logger(RenderPipeline.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly renderer: RendererClient,
    private readonly storage: StorageService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async run(orgId: string, dto: RenderPdfDto, source: 'api' | 'ui'): Promise<RenderOutcome> {
    this.assertWithinSizeLimit(dto.html);

    const startedAt = Date.now();
    const options = dto.options ?? {};

    const document = await this.prisma.document.create({
      data: {
        orgId,
        source,
        status: 'rendering',
        title: dto.title ?? null,
        // Passwords are stripped before anything is persisted (PLAN §3, §4).
        // Phase 1 has no protection block yet; when Phase 5 adds one, it must
        // not reach this column.
        optionsJson: JSON.parse(JSON.stringify(options)) as object,
        expiresAt: this.expiryDate(),
      },
      select: { id: true },
    });

    try {
      const rendered = await this.renderer.render({ html: dto.html, ...options });
      const pageCount = await this.countPages(rendered.pdf);

      const storageKey = this.storage.buildKey(orgId, document.id);
      await this.storage.putPdf(storageKey, rendered.pdf);

      const durationMs = Date.now() - startedAt;

      await this.prisma.document.update({
        where: { id: document.id },
        data: {
          status: 'completed',
          storageKey,
          pageCount,
          byteSize: rendered.pdf.byteLength,
          durationMs,
        },
      });

      this.logger.log(
        `rendered ${document.id}: ${pageCount} page(s), ${rendered.pdf.byteLength} bytes, ${durationMs}ms`,
      );

      return {
        documentId: document.id,
        pdf: rendered.pdf,
        storageKey,
        pageCount,
        byteSize: rendered.pdf.byteLength,
        durationMs,
        filename: dto.filename ?? `${document.id}.pdf`,
      };
    } catch (error) {
      const problem = error instanceof ProblemError ? error : null;

      await this.prisma.document.update({
        where: { id: document.id },
        data: {
          status: 'failed',
          errorCode: problem?.code ?? 'internal_error',
          // A caller-facing message only; never an internal stack or path.
          errorMessage: problem?.detail ?? 'Render failed',
          durationMs: Date.now() - startedAt,
        },
      });

      throw error;
    }
  }

  private assertWithinSizeLimit(html: string): void {
    const max = this.config.get('MAX_HTML_BYTES', { infer: true });
    const size = Buffer.byteLength(html, 'utf8');

    if (size > max) {
      throw new ProblemError(
        'payload_too_large',
        413,
        `HTML is ${size} bytes; the limit is ${max}`,
      );
    }
  }

  private expiryDate(): Date {
    const days = this.config.get('RETENTION_DAYS', { infer: true });
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private async countPages(pdf: Buffer): Promise<number> {
    try {
      const parsed = await PDFDocument.load(pdf, { updateMetadata: false });
      return parsed.getPageCount();
    } catch {
      // A page count is metadata, not the deliverable — never fail a render
      // that already produced a valid PDF because counting went wrong.
      this.logger.warn('could not determine page count');
      return 0;
    }
  }
}
