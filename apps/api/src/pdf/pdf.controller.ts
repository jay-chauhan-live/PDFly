import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentContext } from '../auth/current-context.decorator.js';
import { StorageService } from '../storage/storage.service.js';
import { RenderPdfDto } from './dto/render-pdf.dto.js';
import { RenderPipeline, type RenderAttribution } from './render.pipeline.js';
import type { RequestContext } from '../auth/request-context.js';

@Controller('pdf')
export class PdfController {
  constructor(
    private readonly pipeline: RenderPipeline,
    private readonly storage: StorageService,
  ) {}

  /**
   * Synchronous render (PLAN §6). The caller holds the connection until the
   * PDF exists. `POST /v1/pdf/async` and webhooks arrive in Phase 6.
   */
  @Post()
  async render(
    @Body() dto: RenderPdfDto,
    @CurrentContext() ctx: RequestContext,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.pipeline.run(dto, attributionFor(ctx));
    const output = dto.output ?? 'url';

    if (output === 'binary') {
      response
        .status(201)
        .type('application/pdf')
        .setHeader('content-disposition', `attachment; filename="${result.filename}"`)
        .setHeader('x-document-id', result.documentId)
        .send(result.pdf);
      return;
    }

    const base = {
      id: result.documentId,
      pageCount: result.pageCount,
      byteSize: result.byteSize,
      durationMs: result.durationMs,
      filename: result.filename,
    };

    if (output === 'base64') {
      response.status(201).json({ ...base, pdf: result.pdf.toString('base64') });
      return;
    }

    response.status(201).json({
      ...base,
      url: await this.storage.signedDownloadUrl(result.storageKey, result.filename),
    });
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
