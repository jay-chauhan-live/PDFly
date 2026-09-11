import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { CurrentContext } from '../auth/current-context.decorator.js';
import { DocumentsService } from './documents.service.js';
import { ListDocumentsDto } from './dto/list-documents.dto.js';
import type { RequestContext } from '../auth/request-context.js';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** PLAN §6: list, paginated, filterable. */
  @Get()
  list(@CurrentContext() ctx: RequestContext, @Query() query: ListDocumentsDto) {
    return this.documents.list(ctx.orgId, query);
  }

  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.get(ctx.orgId, id);
  }

  /**
   * Returns the signed link rather than redirecting to it, so the dashboard
   * can use fetch here like everywhere else — a 302 to object storage would
   * force a different code path and leak the URL into browser history.
   */
  @Get(':id/file')
  download(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.downloadUrl(ctx.orgId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentContext() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.documents.remove(ctx.orgId, id, ctx.userId);
  }
}
