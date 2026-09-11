import { Body, Controller, Headers, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentContext } from '../auth/current-context.decorator.js';
import { ProblemError } from '../common/errors/problem.js';
import { DocumentsService } from '../documents/documents.service.js';
import { RequireScopes } from '../tokens/scopes.js';
import { IdempotencyService } from '../usage/idempotency.service.js';
import { StorageService } from '../storage/storage.service.js';
import { RenderPdfDto } from './dto/render-pdf.dto.js';
import { RenderPipeline, type RenderAttribution } from './render.pipeline.js';
import type { RequestContext } from '../auth/request-context.js';

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

interface RenderSummary {
  id: string;
  pageCount: number;
  byteSize: number;
  durationMs: number;
  filename: string;
}

@Controller('pdf')
@RequireScopes('pdf:render')
export class PdfController {
  constructor(
    private readonly pipeline: RenderPipeline,
    private readonly storage: StorageService,
    private readonly documents: DocumentsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Synchronous render (PLAN §6). The caller holds the connection until the
   * PDF exists. `POST /v1/pdf/async` and webhooks arrive in Phase 6.
   */
  @Post()
  async render(
    @Body() dto: RenderPdfDto,
    @CurrentContext() ctx: RequestContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const key = this.normaliseKey(idempotencyKey);
    const output = dto.output ?? 'url';

    if (key) {
      const claim = await this.idempotency.claim(ctx.orgId, key);

      if (claim.outcome === 'in_progress') throw IdempotencyService.conflict();

      if (claim.outcome === 'replay') {
        await this.replay(ctx, claim.documentId, output, response);
        return;
      }
    }

    let result;

    try {
      result = await this.pipeline.run(dto, attributionFor(ctx));
    } catch (error) {
      // A failed render is not a result worth replaying: let a retry try again.
      if (key) await this.idempotency.release(ctx.orgId, key);
      throw error;
    }

    if (key) await this.idempotency.fulfil(ctx.orgId, key, result.documentId);

    await this.send(
      response,
      201,
      {
        id: result.documentId,
        pageCount: result.pageCount,
        byteSize: result.byteSize,
        durationMs: result.durationMs,
        filename: result.filename,
      },
      output,
      { pdf: result.pdf, storageKey: result.storageKey },
    );
  }

  /**
   * The playground's live pane (PLAN §9): the same render, but nothing is
   * recorded or stored. 200 rather than 201 — a preview creates no resource.
   */
  @Post('preview')
  @HttpCode(200)
  async preview(@Body() dto: RenderPdfDto, @Res() response: Response): Promise<void> {
    const result = await this.pipeline.preview(dto);

    response
      .status(200)
      .type('application/pdf')
      .setHeader('content-disposition', 'inline; filename="preview.pdf"')
      .setHeader('x-page-count', String(result.pageCount))
      .setHeader('x-duration-ms', String(result.durationMs))
      .send(result.pdf);
  }

  /**
   * Answers a retried request from the document the first attempt produced.
   *
   * The PDF bytes are long gone from memory, so `binary` and `base64` would
   * mean fetching the object back out of storage. A signed URL is the honest
   * answer for a replay, and the header says the render did not happen again.
   */
  private async replay(
    ctx: RequestContext,
    documentId: string,
    output: string,
    response: Response,
  ): Promise<void> {
    const document = await this.documents.get(ctx.orgId, documentId).catch(() => null);

    if (!document) {
      // Deleted since. Nothing to replay, and re-rendering under the same key
      // would be a surprise, so say what happened.
      throw new ProblemError(
        'conflict',
        409,
        'The document this Idempotency-Key produced has been deleted',
      );
    }

    const { url } = await this.documents.downloadUrl(ctx.orgId, documentId);

    response
      .status(200)
      .setHeader('Idempotent-Replay', 'true')
      .json({
        id: document.id,
        pageCount: document.pageCount,
        byteSize: document.byteSize,
        durationMs: document.durationMs,
        filename: `${document.title ?? document.id}.pdf`,
        ...(output === 'url' ? { url } : { url, note: 'replayed; body formats are not stored' }),
      });
  }

  private async send(
    response: Response,
    status: number,
    summary: RenderSummary,
    output: string,
    payload: { pdf: Buffer; storageKey: string },
  ): Promise<void> {
    if (output === 'binary') {
      response
        .status(status)
        .type('application/pdf')
        .setHeader('content-disposition', `attachment; filename="${summary.filename}"`)
        .setHeader('x-document-id', summary.id)
        .send(payload.pdf);
      return;
    }

    if (output === 'base64') {
      response.status(status).json({ ...summary, pdf: payload.pdf.toString('base64') });
      return;
    }

    response.status(status).json({
      ...summary,
      url: await this.storage.signedDownloadUrl(payload.storageKey, summary.filename),
    });
  }

  private normaliseKey(raw: string | undefined): string | null {
    const key = raw?.trim();

    if (!key) return null;

    if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new ProblemError(
        'invalid_request',
        400,
        `Idempotency-Key must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
      );
    }

    return key;
  }
}

/**
 * A dashboard session carries a user; an API token does not. That is the only
 * honest signal for `source`, and it cannot be spoofed by the request body.
 */
function attributionFor(ctx: RequestContext): RenderAttribution {
  return {
    orgId: ctx.orgId,
    ...(ctx.userId ? { userId: ctx.userId } : {}),
    source: ctx.userId ? 'ui' : 'api',
  };
}
