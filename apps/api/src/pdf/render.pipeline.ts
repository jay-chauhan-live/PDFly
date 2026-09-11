import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PDFDocument } from 'pdf-lib';
import { ProblemError } from '../common/errors/problem.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RendererClient } from '../renderer/renderer.client.js';
import { EncryptionService } from '../protection/encryption.service.js';
import { WatermarkService } from '../protection/watermark.service.js';
import { StorageService } from '../storage/storage.service.js';
import { UsageService } from '../usage/usage.service.js';
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

export interface PreviewOutcome {
  pdf: Buffer;
  pageCount: number;
  byteSize: number;
  durationMs: number;
}

/** Who a render belongs to, and how it arrived. */
export interface RenderAttribution {
  orgId: string;
  /** Absent for an API token: a valid credential with no person behind it. */
  userId?: string;
  source: 'api' | 'ui';
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
    private readonly watermarks: WatermarkService,
    private readonly encryption: EncryptionService,
    private readonly storage: StorageService,
    private readonly usage: UsageService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Renders without recording or storing anything.
   *
   * The playground re-renders on a debounce as someone types (PLAN §9). Each
   * of those keystroke renders is a draft, not a document: persisting them
   * would bury the real history and fill object storage with drafts nobody
   * asked to keep. Skipping the upload also makes the preview noticeably
   * quicker, which is the whole point of a live pane.
   */
  async preview(dto: RenderPdfDto): Promise<PreviewOutcome> {
    this.assertWithinSizeLimit(dto.html);

    const startedAt = Date.now();
    const rendered = await this.renderer.render({ html: dto.html, ...(dto.options ?? {}) });

    // Stamped but never encrypted: an encrypted preview would prompt for a
    // password in the viewer, which is not a preview of anything useful. The
    // watermark is the part worth seeing before committing to a render.
    const stamped = dto.watermark
      ? await this.watermarks.apply(rendered.pdf, dto.watermark)
      : rendered.pdf;

    return {
      pdf: stamped,
      pageCount: await this.countPages(stamped),
      byteSize: stamped.byteLength,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Renders, stores and records, as one unit.
   *
   * `existingDocumentId` is how the async path works: the request handler
   * creates the row so the caller gets an id in its 202, and the worker
   * finishes that same row rather than creating a second one nobody is
   * holding a reference to.
   */
  async run(
    dto: RenderPdfDto,
    by: RenderAttribution,
    existingDocumentId?: string,
  ): Promise<RenderOutcome> {
    this.assertWithinSizeLimit(dto.html);

    const startedAt = Date.now();
    const options = dto.options ?? {};
    const { orgId } = by;

    const document = existingDocumentId
      ? await this.prisma.document.update({
          where: { id: existingDocumentId },
          // The protection block is only known now, on the worker, so the two
          // flags are set here rather than at enqueue time.
          data: {
            status: 'rendering',
            isEncrypted: dto.protection !== undefined,
            hasWatermark: dto.watermark !== undefined,
          },
          select: { id: true },
        })
      : await this.prisma.document.create({
          data: {
            orgId,
            createdBy: by.userId ?? null,
            source: by.source,
            status: 'rendering',
            title: dto.title ?? null,
            // Reproducibility without the secrets: the settings are recorded,
            // the passwords are not (PLAN §3, §4).
            optionsJson: reproducibleOptions(dto),
            isEncrypted: dto.protection !== undefined,
            hasWatermark: dto.watermark !== undefined,
            expiresAt: this.expiryDate(),
          },
          select: { id: true },
        });

    try {
      const rendered = await this.renderer.render({ html: dto.html, ...options });

      // Page count comes from the rendered document, before encryption makes
      // it unreadable to us as well as to everyone else.
      const pageCount = await this.countPages(rendered.pdf);

      this.assertWithinPageLimit(pageCount);

      // Order is not negotiable (PLAN §3): an encrypted PDF cannot be stamped,
      // so the watermark goes on first and encryption is always last.
      const stamped = dto.watermark
        ? await this.watermarks.apply(rendered.pdf, dto.watermark)
        : rendered.pdf;

      const final = dto.protection
        ? await this.encryption.encrypt(stamped, dto.protection)
        : stamped;

      const storageKey = this.storage.buildKey(orgId, document.id);
      await this.storage.putPdf(storageKey, final);

      const durationMs = Date.now() - startedAt;

      await this.prisma.document.update({
        where: { id: document.id },
        data: {
          status: 'completed',
          storageKey,
          pageCount,
          byteSize: final.byteLength,
          durationMs,
        },
      });

      await this.usage.recordRender(orgId, {
        pages: pageCount,
        bytes: final.byteLength,
        failed: false,
      });

      this.logger.log(
        `rendered ${document.id}: ${pageCount} page(s), ${final.byteLength} bytes, ${durationMs}ms`,
      );

      return {
        documentId: document.id,
        pdf: final,
        storageKey,
        pageCount,
        byteSize: final.byteLength,
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

      // A failed render still consumed a browser and a slot in the pool, so it
      // is metered — separately, so a caller can see that the failures are
      // theirs rather than a mystery in the bill.
      await this.usage.recordRender(orgId, { pages: 0, bytes: 0, failed: true });

      throw error;
    }
  }

  /**
   * Records the intent to render, before anything has been rendered. The
   * async path needs a document id to hand back in its 202.
   */
  async reserve(dto: RenderPdfDto, by: RenderAttribution): Promise<string> {
    this.assertWithinSizeLimit(dto.html);

    const document = await this.prisma.document.create({
      data: {
        orgId: by.orgId,
        createdBy: by.userId ?? null,
        source: by.source,
        status: 'queued',
        title: dto.title ?? null,
        optionsJson: reproducibleOptions(dto),
        isEncrypted: dto.protection !== undefined,
        hasWatermark: dto.watermark !== undefined,
        expiresAt: this.expiryDate(),
      },
      select: { id: true },
    });

    return document.id;
  }

  /**
   * A page cap (PLAN §11). Markup with a runaway loop or an enormous table
   * produces a document nobody wanted, and the cost of watermarking,
   * encrypting and storing it is real. Checked after rendering because there
   * is no way to know the count before.
   */
  private assertWithinPageLimit(pageCount: number): void {
    const max = this.config.get('MAX_PAGES', { infer: true });

    if (pageCount > max) {
      throw new ProblemError(
        'payload_too_large',
        413,
        `This document is ${pageCount} pages; the limit is ${max}`,
      );
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

/**
 * The settings a render can be reproduced from, with every secret removed.
 *
 * Built by naming what goes in rather than by deleting what must not: a new
 * password-shaped field added to the DTO later is excluded by default, which
 * is the failure mode you want. The watermark keeps its placement but drops
 * any embedded image, which would bloat the row for no reproducibility gain.
 */
function reproducibleOptions(dto: RenderPdfDto): object {
  const { imageBase64: _image, ...watermark } = dto.watermark ?? {};

  return JSON.parse(
    JSON.stringify({
      ...(dto.options ?? {}),
      ...(dto.watermark ? { watermark: { ...watermark, ...(_image ? { image: true } : {}) } } : {}),
      ...(dto.protection
        ? {
            protection: {
              // Recorded as facts about the document, never as values.
              hasUserPassword: dto.protection.userPassword !== undefined,
              hasOwnerPassword: dto.protection.ownerPassword !== undefined,
              permissions: dto.protection.permissions ?? {},
            },
          }
        : {}),
    }),
  ) as object;
}
